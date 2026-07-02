import { generateToken, getClearAuthCookieOptions } from "../lib/utils.js";
import User from "../models/user.model.js";
import bcrypt from "bcryptjs";
import cloudinary from "../lib/cloudinary.js";
import { COOKIE_NAME } from "../constants.js";
import { generateUniqueUsername } from "../lib/username.js";

/**
 * Derive a Cloudinary public_id from a stored secure_url so we can delete the
 * asset later. Returns null for non-Cloudinary URLs (e.g. the empty default or
 * an external seed avatar), which the caller treats as "nothing to delete".
 * Example: .../upload/v1700/chat-app/profiles/abc.jpg -> chat-app/profiles/abc
 * @param {string} url - a Cloudinary secure_url
 * @returns {string|null} the public_id, or null if it can't be derived
 */
const getCloudinaryPublicId = (url) => {
  if (typeof url !== "string" || !url.includes("/upload/")) return null;
  const afterUpload = url.split("/upload/")[1];
  const withoutVersion = afterUpload.replace(/^v\d+\//, "");
  const withoutExtension = withoutVersion.replace(/\.[^/.]+$/, "");
  return withoutExtension || null;
};

/**
 * Handle user signup - Create new user account with hashed password and unique username
 * @param {Object} req - Request body: { fullName, email, password, username? }
 * @param {Object} res - Response object returning user data or error
 * @returns {void} Returns created user or error message
 */
export const signup = async (req, res) => {
  const { fullName, email, password, username: requestedUsername } = req.body;
  try {
    if (!fullName || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    const user = await User.findOne({ email });

    if (user) return res.status(400).json({ message: "Email already exists" });

    // Handle username: use provided or auto-generate
    let username = requestedUsername?.toLowerCase().trim();
    
    if (username) {
      // Validate requested username
      if (username.length < 3 || username.length > 20) {
        return res.status(400).json({ message: "Username must be 3-20 characters" });
      }
      if (!/^[a-z0-9_]+$/.test(username)) {
        return res.status(400).json({ message: "Username can only contain letters, numbers, and underscores" });
      }
      
      // Check if username is already taken
      const existingUsername = await User.findOne({ username });
      if (existingUsername) {
        return res.status(400).json({ message: "Username already taken" });
      }
    } else {
      // Auto-generate username from fullName
      username = await generateUniqueUsername(fullName, async (un) => {
        const existing = await User.findOne({ username: un });
        return !!existing;
      });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
      fullName,
      email,
      username,
      password: hashedPassword,
    });

    if (newUser) {
      generateToken(newUser._id, res);
      await newUser.save();

      res.status(201).json({
        _id: newUser._id,
        fullName: newUser.fullName,
        email: newUser.email,
        username: newUser.username,
        profilePic: newUser.profilePic,
      });
    } else {
      res.status(400).json({ message: "Invalid user data" });
    }
  } catch (error) {
    console.log("Error in signup controller", error.message);
    if (error.code === 11000) {
      // Duplicate key error
      const field = Object.keys(error.keyPattern)[0];
      return res.status(400).json({ message: `${field} already exists` });
    }
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * Handle user login - Verify credentials and generate authentication token
 * @param {Object} req - Request body: { email, password }
 * @param {Object} res - Response object returning user data or error
 * @returns {void} Returns authenticated user or error message
 */
export const login = async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(400).json({ message: "Invalid credentials" });
    }

    generateToken(user._id, res);

    res.status(200).json({
      _id: user._id,
      fullName: user.fullName,
      email: user.email,
      username: user.username,
      profilePic: user.profilePic,
    });
  } catch (error) {
    console.log("Error in login controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * Handle user logout - Clear authentication cookie
 * @param {Object} req - Express request object
 * @param {Object} res - Response object
 * @returns {void} Returns logout success message
 */
export const logout = (req, res) => {
  try {
    res.clearCookie(COOKIE_NAME, getClearAuthCookieOptions());
    res.status(200).json({ message: "Logged out successfully" });
  } catch (error) {
    console.log("Error in logout controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};

/**
 * Update user profile picture - Upload new image to Cloudinary
 * Requires authentication middleware
 * @param {Object} req - Request body: { profilePic (base64) }, authenticated user in req.user
 * @param {Object} res - Response object returning updated user
 * @returns {void} Returns updated user or error message
 */
export const updateProfile = async (req, res) => {
  try {
    const { profilePic } = req.body;
    const userId = req.user._id;

    if (!profilePic) {
      return res.status(400).json({ message: "Profile pic is required" });
    }

    if (typeof profilePic !== "string" || !profilePic.startsWith("data:image/")) {
      return res.status(400).json({ message: "Profile pic must be a valid image data URL" });
    }

    const uploadResponse = await cloudinary.uploader.upload(profilePic, {
      folder: "chat-app/profiles",
      resource_type: "image",
    });
    const previousPublicId = getCloudinaryPublicId(req.user.profilePic);
    const updatedUser = await User.findByIdAndUpdate(
      userId,
      { profilePic: uploadResponse.secure_url },
      { new: true }
    );

    res.status(200).json(updatedUser);

    // Best-effort cleanup of the old avatar so we don't leak Cloudinary storage.
    // Done after responding (the user doesn't need to wait) and never throws.
    if (previousPublicId) {
      cloudinary.uploader
        .destroy(previousPublicId)
        .catch((err) => console.log("Failed to delete old profile pic:", err.message));
    }
  } catch (error) {
    console.log("error in update profile:", error);
    res.status(500).json({ message: "Internal server error" });
  }
};

/**
 * Check if user is authenticated - Return authenticated user data
 * Requires authentication middleware (protectRoute)
 * @param {Object} req - Express request with authenticated user in req.user
 * @param {Object} res - Response object
 * @returns {void} Returns authenticated user data or error
 */
export const checkAuth = (req, res) => {
  try {
    res.status(200).json(req.user);
  } catch (error) {
    console.log("Error in checkAuth controller", error.message);
    res.status(500).json({ message: "Internal Server Error" });
  }
};
