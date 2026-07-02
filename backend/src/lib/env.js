import dotenv from "dotenv";

// Loads backend/.env from the current working directory. Every way the backend
// starts (npm scripts, scripts/dev.mjs) runs with the backend/ folder as the
// CWD, so the default lookup finds it — no brittle relative path needed. The
// seed script loads env the same way, keeping the whole backend consistent.
dotenv.config();

const parseList = (value, fallback) => {
  const parsed = value
    ?.split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return parsed?.length ? parsed : fallback;
};

export const NODE_ENV = process.env.NODE_ENV || "development";
export const isProduction = NODE_ENV === "production";
export const PORT = Number(process.env.PORT) || 5001;
export const CLIENT_ORIGINS = parseList(process.env.CLIENT_URL, ["http://localhost:5173"]);
// Must be large enough to hold a base64-encoded file attachment. A 5MB file
// becomes ~6.7MB once base64-encoded, so the limit needs headroom above that.
export const JSON_LIMIT = process.env.JSON_LIMIT || "8mb";

export function assertRequiredEnv() {
  const requiredVars = ["TOKEN_SECRET", "CONNECTION_STRING"];
  const missing = requiredVars.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }

  if (isProduction && process.env.TOKEN_SECRET.length < 32) {
    throw new Error("TOKEN_SECRET must be at least 32 characters in production");
  }
}
