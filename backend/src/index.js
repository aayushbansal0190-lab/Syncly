import express from "express";
import cookieParser from "cookie-parser";
import cors from "cors";

import { connectDB } from "./lib/db.js";

import authRoutes from "./routes/auth.route.js";
import messageRoutes from "./routes/message.route.js";
import { app, server } from "./lib/socket.js";

import dotenv from "dotenv";
dotenv.config();

const PORT = process.env.PORT ;

app.use(express.json());
app.use(cookieParser());
app.use(
  cors({
    origin: "http://localhost:5173",
    credentials: true,
  })
);

app.use("/api/auth", authRoutes);
app.use("/api/messages", messageRoutes);

app.get("/" , (req, res) => {
  res.send("API is working");
} )

server.listen(PORT, () => {
  console.log("server is running on PORT:" + PORT);
  connectDB();
});
