import { Server } from "socket.io";
import http from "http";
import express from "express";
import "./env.js";
import { SOCKET_EVENTS } from "../constants.js";

const app = express();
const server = http.createServer(app);
const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:5173";

const io = new Server(server, {
  cors: {
    origin: [CLIENT_URL],
    credentials: true,
  },
});

export function getReceiverSocketId(userId) {
  return userSocketMap[userId];
}

const userSocketMap = {};

io.on("connection", (socket) => {
  console.log("A user connected", socket.id);

  const userId = socket.handshake.query.userId;
  if (userId) userSocketMap[userId] = socket.id;

  io.emit(SOCKET_EVENTS.GET_ONLINE_USERS, Object.keys(userSocketMap));

  socket.on("disconnect", () => {
    console.log("A user disconnected", socket.id);
    delete userSocketMap[userId];
    io.emit(SOCKET_EVENTS.GET_ONLINE_USERS, Object.keys(userSocketMap));
  });
});

export { io, app, server };
