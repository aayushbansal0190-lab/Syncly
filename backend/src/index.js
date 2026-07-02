import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import mongoose from "mongoose";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRequiredEnv,
  CLIENT_ORIGINS,
  isProduction,
  JSON_LIMIT,
  NODE_ENV,
  PORT,
} from "./lib/env.js";
import { connectDB } from "./lib/db.js";
import { initializeIndexes } from "./lib/database-indexes.js";
import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import friendRoutes from "./routes/friend.route.js";
import aiRoutes from "./routes/ai.route.js";
import { app, server, io } from "./lib/socket.js";
import { logError, logInfo, requestLogger } from "./lib/logger.js";

assertRequiredEnv();

if (isProduction) {
  app.set("trust proxy", 1);
}

const corsOptions = {
  origin(origin, callback) {
    if (!origin || CLIENT_ORIGINS.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { message: "Too many auth attempts. Please try again later." },
});

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        imgSrc: ["'self'", "data:", "https://res.cloudinary.com"],
      },
    },
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);
app.use(express.json({ limit: JSON_LIMIT }));
app.use(express.urlencoded({ extended: true, limit: JSON_LIMIT }));
app.use(cookieParser());
app.use(cors(corsOptions));
app.use(requestLogger);

app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    status: "healthy",
    uptime: process.uptime(),
    requestId: req.requestId,
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : mongoose.connection.readyState === 2
          ? "connecting"
          : "disconnected",
    timestamp: new Date().toISOString(),
  });
});

app.use("/api", apiLimiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/friends", friendRoutes);
app.use("/api/ai", aiRoutes);

// Serve the built frontend in production (single-service deploy).
if (NODE_ENV === "production") {
  const distDir = fileURLToPath(new URL("../../frontend/dist/", import.meta.url));
  app.use(express.static(distDir));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  app.get("/", (req, res) => {
    res.send("API is working");
  });
}

const startServer = async () => {
  await connectDB();
  await initializeIndexes();

  server.listen(PORT, () => {
    logInfo("server_started", {
      port: PORT,
      environment: NODE_ENV,
    });
  });
};

process.on("unhandledRejection", (reason) => {
  logError("unhandled_rejection", reason);
});

process.on("uncaughtException", (error) => {
  logError("uncaught_exception", error);
});

// Graceful shutdown: when the platform (e.g. Render) redeploys or stops the
// app, the OS sends SIGTERM (or SIGINT on Ctrl+C locally). Instead of dying
// instantly and dropping in-flight requests, we stop accepting new connections,
// finish what's in progress, close the DB connection, then exit cleanly.
let isShuttingDown = false;

const shutdown = (signal) => {
  if (isShuttingDown) return; // ignore repeated signals
  isShuttingDown = true;
  logInfo("shutdown_started", { signal });

  // io.close() disconnects all live websocket clients AND closes the underlying
  // HTTP server. We must do this, otherwise open sockets would keep the server
  // alive and block shutdown. The callback runs once everything is closed.
  io.close(async () => {
    try {
      await mongoose.connection.close();
      logInfo("shutdown_complete", {});
      process.exit(0);
    } catch (error) {
      logError("shutdown_error", error);
      process.exit(1);
    }
  });

  // Safety net: if something hangs and we can't close within 10s, force-exit so
  // the platform isn't left waiting forever. .unref() lets the process exit
  // naturally if it finishes before the timer fires.
  setTimeout(() => {
    logError("shutdown_forced", new Error("Timed out closing connections"));
    process.exit(1);
  }, 10000).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

startServer().catch((error) => {
  logError("failed_to_start_server", error);
  process.exit(1);
});
