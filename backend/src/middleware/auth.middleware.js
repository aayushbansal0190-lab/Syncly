import jwt from "jsonwebtoken";
import User from "../models/user.model.js";
import "../lib/env.js";
import { COOKIE_NAME } from "../constants.js";

/**
 * Middleware to verify JWT token and protect routes from unauthorized access
 * Extracts user from token and attaches to request object
 * @param {Object} req - Express request object containing JWT cookie
 * @param {Object} res - Express response object
 * @param {Function} next - Express next middleware function
 * @returns {void}
 */
export const protectRoute = async (req, res, next) => {
  try {
    const token = req.cookies[COOKIE_NAME];

    if (!token) {
      return res.status(401).json({ message: "Unauthorized - No Token Provided" });
    }

    const decoded = jwt.verify(token, process.env.TOKEN_SECRET );

    if (!decoded) {
      return res.status(401).json({ message: "Unauthorized - Invalid Token" });
    }

    const user = await User.findById(decoded.userId).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    req.user = user;

    next();
  } catch (error) {
    console.log("Error in protectRoute middleware: ", error.message);
    res.status(500).json({ message: "Internal server error" });
  }
};
