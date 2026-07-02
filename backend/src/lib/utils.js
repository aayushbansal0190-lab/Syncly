import jwt from "jsonwebtoken";
import "./env.js";
import { COOKIE_NAME } from "../constants.js";
import { isProduction } from "./env.js";

export const getAuthCookieOptions = () => ({
  maxAge: 7 * 24 * 60 * 60 * 1000,
  httpOnly: true,
  sameSite: isProduction ? "none" : "lax",
  secure: isProduction,
  path: "/",
});

export const getClearAuthCookieOptions = () => {
  const { maxAge, ...options } = getAuthCookieOptions();
  return options;
};

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

  res.cookie(COOKIE_NAME, token, getAuthCookieOptions());

  return token;
};
