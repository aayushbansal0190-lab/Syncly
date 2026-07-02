import { Server } from "socket.io";
import http from "http";
import express from "express";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";
import { CLIENT_ORIGINS } from "./env.js";
import { SOCKET_EVENTS, COOKIE_NAME } from "../constants.js";
import { logError, logInfo } from "./logger.js";

const app = express();
const server = http.createServer(app);

// Add middleware to parse cookies for Socket.io
app.use(cookieParser());

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGINS,
    credentials: true, // Allow cookies to be sent with withCredentials: true
  },
});

export function getReceiverSocketId(userId) {
  // MULTI-TAB FIX: Return array of socket IDs for this user (handles multiple tabs/devices)
  const sockets = userSocketMap[userId];
  return sockets && sockets.length > 0 ? sockets : null;
}

const userSocketMap = {};

io.on("connection", (socket) => {
  try {
    let userId;
    
    // Try to get JWT from handshake auth first (if manually set by client)
    if (socket.handshake.auth?.token) {
      const decoded = jwt.verify(socket.handshake.auth.token, process.env.TOKEN_SECRET);
      userId = decoded.userId;
    } 
    // Otherwise, try to extract from cookies (httpOnly cookies are auto-sent with withCredentials)
    else {
      const cookieString = socket.request.headers.cookie || "";
      const token = cookieString
        .split(";")
        .map((part) => part.trim())
        .find((row) => row.startsWith(`${COOKIE_NAME}=`))
        ?.split("=")[1];

      if (!token) {
        socket.disconnect(true);
        logInfo("socket_rejected", { socketId: socket.id, reason: "no_token" });
        return;
      }

      const decoded = jwt.verify(decodeURIComponent(token), process.env.TOKEN_SECRET);
      userId = decoded.userId;
    }

    if (!userId) {
      socket.disconnect(true);
      logInfo("socket_rejected", { socketId: socket.id, reason: "invalid_token_payload" });
      return;
    }

    // MULTI-TAB FIX: Support multiple sockets per user (for multiple tabs/devices)
    if (!userSocketMap[userId]) {
      userSocketMap[userId] = [];
    }
    userSocketMap[userId].push(socket.id);
    socket.userId = userId;

    logInfo("socket_connected", {
      userId,
      socketId: socket.id,
      userSockets: userSocketMap[userId].length,
    });

    // Emit list of online USER IDs (not socket IDs)
    io.emit(SOCKET_EVENTS.GET_ONLINE_USERS, Object.keys(userSocketMap));
  } catch (error) {
    socket.disconnect(true);
    logInfo("socket_rejected", { socketId: socket.id, reason: error.message });
    return;
  }

  // Handle message seen status updates
  socket.on(SOCKET_EVENTS.MESSAGE_SEEN, async (data) => {
    const { messageId } = data;
    try {
      // Import Message model to update status
      const Message = (await import("../models/message.model.js")).default;
      const message = await Message.findById(messageId);

      if (!message) {
        return;
      }

      // CRITICAL SECURITY FIX: Verify that caller is the actual receiver
      if (message.receiverId.toString() !== socket.userId) {
        logInfo("message_seen_denied", { userId: socket.userId, messageId });
        return; // Silently ignore unauthorized attempts
      }

      message.status = "seen";
      await message.save();

      // Emit message seen event to sender - handle multiple sockets for multi-tab
      const senderSocketIds = getReceiverSocketId(message.senderId.toString());
      if (senderSocketIds) {
        const ids = Array.isArray(senderSocketIds) ? senderSocketIds : [senderSocketIds];
        ids.forEach(socketId => {
          io.to(socketId).emit(SOCKET_EVENTS.MESSAGE_SEEN, { messageId });
        });
      }
    } catch (error) {
      logError("message_seen_error", error);
    }
  });

  // ===== WebRTC video-call signaling =====
  // The server is just a relay: it forwards offer/answer/ICE/reject/end between
  // the two users by looking up the target user's live socket(s). The actual
  // audio/video flows peer-to-peer and never touches the server.
  const relayToUser = (toUserId, event, payload) => {
    const ids = getReceiverSocketId(String(toUserId));
    if (!ids) return false;
    ids.forEach((sid) => io.to(sid).emit(event, payload));
    return true;
  };

  socket.on(SOCKET_EVENTS.CALL_OFFER, ({ toUserId, offer, caller }) => {
    const delivered = relayToUser(toUserId, SOCKET_EVENTS.CALL_OFFER, {
      from: socket.userId,
      offer,
      caller,
    });
    // Tell the caller immediately if the callee isn't online.
    if (!delivered) {
      socket.emit(SOCKET_EVENTS.CALL_UNAVAILABLE, { toUserId });
    }
  });

  socket.on(SOCKET_EVENTS.CALL_ANSWER, ({ toUserId, answer }) => {
    relayToUser(toUserId, SOCKET_EVENTS.CALL_ANSWER, { from: socket.userId, answer });
  });

  socket.on(SOCKET_EVENTS.CALL_ICE, ({ toUserId, candidate }) => {
    relayToUser(toUserId, SOCKET_EVENTS.CALL_ICE, { from: socket.userId, candidate });
  });

  socket.on(SOCKET_EVENTS.CALL_REJECT, ({ toUserId }) => {
    relayToUser(toUserId, SOCKET_EVENTS.CALL_REJECT, { from: socket.userId });
  });

  socket.on(SOCKET_EVENTS.CALL_END, ({ toUserId }) => {
    relayToUser(toUserId, SOCKET_EVENTS.CALL_END, { from: socket.userId });
  });

  // Handle disconnect
  socket.on("disconnect", () => {
    // MULTI-TAB FIX: Remove only this socket, not all sockets for user
    if (socket.userId && userSocketMap[socket.userId]) {
      userSocketMap[socket.userId] = userSocketMap[socket.userId].filter(id => id !== socket.id);
      // If no more sockets for this user, remove user entry
      if (userSocketMap[socket.userId].length === 0) {
        delete userSocketMap[socket.userId];
      }
      logInfo("socket_disconnected", {
        userId: socket.userId,
        socketId: socket.id,
        userSockets: userSocketMap[socket.userId]?.length ?? 0,
      });
    }

    io.emit(SOCKET_EVENTS.GET_ONLINE_USERS, Object.keys(userSocketMap));
  });
});

export { io, app, server };
