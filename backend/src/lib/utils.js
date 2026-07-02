import jwt from "jsonwebtoken";
import "./env.js";
import { COOKIE_NAME } from "../constants.js";

/**
 * Generate a JWT authentication token and set it as an HTTP-only cookie
 * @param {string} userId - The user's MongoDB ID to encode in the token
 * @param {Object} res - Express response object to set the cookie on
 * @returns {string} The generated JWT token
 */
export const generateToken = (userId, res) => {
  const token = jwt.sign({ userId }, process.env.TOKEN_SECRET , {
    expiresIn: "7d",
  });

  res.cookie(COOKIE_NAME, token, {
    maxAge: 7 * 24 * 60 * 60 * 1000, // MS
    httpOnly: true, // prevent XSS attacks cross-site scripting attacks
    sameSite: "strict", // CSRF attacks cross-site request forgery attacks
    secure: process.env.NODE_ENV === "production",
  });

  return token;
};
