import User from "../models/user.model.js";
import Message from "../models/message.model.js";
import FriendRequest from "../models/friendRequest.model.js";
import mongoose from "mongoose";
import cloudinary from "../lib/cloudinary.js";
import { getReceiverSocketId, io } from "../lib/socket.js";
import { SOCKET_EVENTS } from "../constants.js";
import { messageCache } from "../lib/message-cache.js";

const MAX_MESSAGE_TEXT_LENGTH = 4000;

// File attachment limits. Size is enforced from the actual decoded bytes (not the
// client's claimed size), and only these MIME types are accepted.
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB
const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "application/msword", // .doc
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.ms-excel", // .xls
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.ms-powerpoint", // .ppt
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "text/plain", // .txt
  "application/zip",
  "application/x-zip-compressed", // .zip (some browsers report this)
  // Voice notes (recorded in-browser). Format depends on the browser:
  // Chrome/Firefox produce audio/webm, Safari audio/mp4.
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
];

/**
 * Get all friends for sidebar display (users that have accepted friend requests)
 * Requires authentication middleware
 * @param {Object} req - Express request with authenticated user in req.user
 * @param {Object} res - Response object
 * @returns {void} Returns array of friend user objects
 */
export const getUsersForSidebar = async (req, res) => {
  try {
    const loggedInUserId = req.user._id;

    // Get all accepted friend requests where user is sender or receiver
    const friendRequests = await FriendRequest.find({
      $or: [{ sender: loggedInUserId }, { receiver: loggedInUserId }],
      status: "accepted",
    })
      .populate("sender", "_id username fullName profilePic createdAt updatedAt")
      .populate("receiver", "_id username fullName profilePic createdAt updatedAt")
      .lean();

    // Extract friend objects (the other user in each request)
    const friends = friendRequests.map((request) => {
      if (request.sender._id.toString() === loggedInUserId.toString()) {
        return request.receiver;
      } else {
        return request.sender;
      }
    });

    res.status(200).json(friends);
  } catch (error) {
    console.error("Error in getUsersForSidebar: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get messages between logged-in user and another user with pagination
 * Fetches both sent and received messages (50 per page)
 * Uses caching for performance
 * Requires authentication middleware
 * @param {Object} req - Request params: { id: userToChatId }, query: { page, limit }
 * @param {Object} res - Response object
 * @returns {void} Returns paginated messages with metadata
 */
export const getMessages = async (req, res) => {
  try {
    const { id: userToChatId } = req.params;
    const rawPage = Number.parseInt(req.query.page, 10) || 1;
    const rawLimit = Number.parseInt(req.query.limit, 10) || 50;
    const page = Math.max(1, rawPage);
    const limit = Math.min(100, Math.max(1, rawLimit));
    const myId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(userToChatId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }

    const userToChatObjectId = new mongoose.Types.ObjectId(userToChatId);

    // Check cache first
    const cachedResult = messageCache.get(myId, userToChatId, page, limit);
    if (cachedResult) {
      return res.status(200).json({
        ...cachedResult,
        page,
        limit,
        cached: true,
      });
    }

    const skip = (page - 1) * limit;

    const messagesDesc = await Message.find({
      $or: [
        { senderId: myId, receiverId: userToChatObjectId },
        { senderId: userToChatObjectId, receiverId: myId },
      ],
    })
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit + 1)
      .lean();

    const hasMore = messagesDesc.length > limit;
    const messages = messagesDesc.slice(0, limit).reverse();

    // Cache the result
    messageCache.set(myId, userToChatId, page, limit, { messages, hasMore });

    res.status(200).json({
      messages,
      hasMore,
      page,
      limit,
      cached: false,
    });
  } catch (error) {
    console.log("Error in getMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Send a message to another user with optional image attachment
 * Validates message content, uploads image if provided, emits real-time update via Socket.io
 * Invalidates cache for faster inbox updates
 * Requires authentication middleware
 * @param {Object} req - Request body: { text, image (base64) }, params: { id: receiverId }
 * @param {Object} res - Response object
 * @returns {void} Returns created message immediately (optimistic update)
 */
export const sendMessage = async (req, res) => {
  try {
    const { text, image, file } = req.body;
    const { id: receiverId } = req.params;
    const senderId = req.user._id;
    const trimmedText = typeof text === "string" ? text.trim() : "";
    const imageData = typeof image === "string" ? image.trim() : "";
    // A file attachment arrives as { data: <base64 data URL>, name } on req.body.file.
    const fileData =
      file && typeof file === "object" && typeof file.data === "string" ? file.data.trim() : "";

    if (!mongoose.Types.ObjectId.isValid(receiverId)) {
      return res.status(400).json({ message: "Invalid receiver id" });
    }

    if (String(senderId) === String(receiverId)) {
      return res.status(400).json({ message: "You cannot message yourself" });
    }

    if (!trimmedText && !imageData && !fileData) {
      return res.status(400).json({ message: "Message must contain text, image, or file" });
    }

    if (trimmedText.length > MAX_MESSAGE_TEXT_LENGTH) {
      return res.status(400).json({ message: "Message text is too long" });
    }

    if (imageData && !imageData.startsWith("data:image/")) {
      return res.status(400).json({ message: "Image must be a valid image data URL" });
    }

    // Validate the file attachment up front (before any network calls). We derive
    // the MIME type from the data URL itself rather than trusting a client-sent
    // value, and enforce the size from the actual decoded bytes.
    let detectedFileType = null;
    if (fileData) {
      const match = /^data:([^;]+);base64,/.exec(fileData);
      detectedFileType = match?.[1];
      if (!detectedFileType || !ALLOWED_FILE_TYPES.includes(detectedFileType)) {
        return res.status(400).json({ message: "File type is not allowed" });
      }
      const base64Body = fileData.slice(fileData.indexOf(",") + 1);
      const approxBytes = Math.floor((base64Body.length * 3) / 4);
      if (approxBytes > MAX_FILE_SIZE_BYTES) {
        return res.status(400).json({ message: "File is too large (max 5MB)" });
      }
    }

    const receiverExists = await User.exists({ _id: receiverId });
    if (!receiverExists) {
      return res.status(404).json({ message: "Receiver not found" });
    }

    // AUTHORIZATION: you may only message someone you're actually friends with.
    // The UI only ever shows friends, but a crafted API request could target any
    // user id — this server-side check is what actually enforces it.
    const areFriends = await FriendRequest.exists({
      status: "accepted",
      $or: [
        { sender: senderId, receiver: receiverId },
        { sender: receiverId, receiver: senderId },
      ],
    });
    if (!areFriends) {
      return res.status(403).json({ message: "You can only message your friends" });
    }

    // FIX: Upload image FIRST if provided, fail fast if upload fails (prevents partial success)
    let imageUrl = null;
    if (imageData) {
      try {
        const uploadResponse = await cloudinary.uploader.upload(imageData, {
          folder: "chat-app/messages",
          resource_type: "image",
        });
        imageUrl = uploadResponse.secure_url;
      } catch (uploadError) {
        console.error("Image upload failed:", uploadError.message);
        return res.status(400).json({ message: "Image upload failed. Please try again." });
      }
    }

    // Upload the file attachment. For documents/zips, resource_type "auto" stores
    // them as raw files. For voice notes (recorded as webm/mp4, which don't play
    // cross-browser — Safari can't decode webm), we upload as a "video" asset and
    // convert to mp3, which every browser can play. So the stored URL is always an
    // mp3, regardless of what the recorder produced.
    let filePayload = null;
    if (fileData) {
      const isAudio = detectedFileType.startsWith("audio/");
      try {
        const uploadResponse = await cloudinary.uploader.upload(fileData, {
          folder: "chat-app/files",
          resource_type: isAudio ? "video" : "auto",
          ...(isAudio ? { format: "mp3" } : {}),
        });
        filePayload = {
          url: uploadResponse.secure_url,
          name: isAudio ? "voice-message.mp3" : typeof file.name === "string" && file.name ? file.name : "file",
          // Normalize audio to mp3 so the client renders the right player and it
          // plays everywhere.
          type: isAudio ? "audio/mpeg" : detectedFileType,
          size: uploadResponse.bytes ?? 0,
        };
      } catch (uploadError) {
        console.error("File upload failed:", uploadError.message);
        return res.status(400).json({ message: "File upload failed. Please try again." });
      }
    }

    const receiverSocketIds = getReceiverSocketId(receiverId);

    // Now create and save message with all data (text + image URL + file or just text)
    const newMessage = new Message({
      senderId,
      receiverId,
      text: trimmedText,
      image: imageUrl, // Either has URL or is null
      file: filePayload, // Either has file metadata or is null
      status: receiverSocketIds ? "received" : "sent",
    });

    await newMessage.save();

    // Invalidate cache for both users before clients refetch.
    messageCache.invalidateChat(senderId, receiverId);

    // Send response with complete message
    res.status(201).json(newMessage);

    // TICK MECHANISM FIX: Emit real-time events with proper status updates
    if (receiverSocketIds) {
      // Message is delivered - receiver is online
      const ids = Array.isArray(receiverSocketIds) ? receiverSocketIds : [receiverSocketIds];
      
      // Send NEW_MESSAGE event to receiver(s)
      ids.forEach(socketId => {
        io.to(socketId).emit(SOCKET_EVENTS.NEW_MESSAGE, newMessage);
      });

      // Immediately notify sender of delivery (shows double tick)
      const senderSocketIds = getReceiverSocketId(senderId.toString());
      if (senderSocketIds) {
        const senderIds = Array.isArray(senderSocketIds) ? senderSocketIds : [senderSocketIds];
        senderIds.forEach((socketId) => {
          io.to(socketId).emit(SOCKET_EVENTS.MESSAGE_RECEIVED, {
            messageId: newMessage._id,
            status: newMessage.status,
          });
        });
      }
    }
  } catch (error) {
    console.log("Error in sendMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Escape regex metacharacters so a user's search text is treated as a literal
 * string. Without this, input like ".*" would match everything and crafted
 * input could cause catastrophic backtracking (a ReDoS risk).
 * @param {string} str - raw user input
 * @returns {string} regex-safe string
 */
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Search messages within a single conversation (between the logged-in user and
 * the user given in params) by text content. Excludes deleted messages.
 * Requires authentication middleware.
 * @param {Object} req - params: { id: otherUserId }, query: { q: searchText }
 * @param {Object} res - Response object
 * @returns {void} Returns { results: Message[] } (max 50, newest first)
 */
export const searchMessages = async (req, res) => {
  try {
    const { id: otherUserId } = req.params;
    const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const myId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(otherUserId)) {
      return res.status(400).json({ message: "Invalid user id" });
    }
    // Empty query: nothing to search for, return an empty result set.
    if (!q) {
      return res.status(200).json({ results: [] });
    }

    const otherObjectId = new mongoose.Types.ObjectId(otherUserId);
    const pattern = new RegExp(escapeRegex(q), "i"); // "i" = case-insensitive

    const results = await Message.find({
      isDeleted: { $ne: true },
      text: pattern,
      $or: [
        { senderId: myId, receiverId: otherObjectId },
        { senderId: otherObjectId, receiverId: myId },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();

    res.status(200).json({ results });
  } catch (error) {
    console.log("Error in searchMessages controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Emit a socket event to every live socket of the given users (multi-tab safe).
 * Used to push edit/delete updates to both the sender's other tabs and the
 * receiver in real time.
 * @param {Array} userIds - user ids to notify
 * @param {string} event - socket event name
 * @param {Object} payload - data to send
 */
const emitToParticipants = (userIds, event, payload) => {
  userIds.forEach((uid) => {
    const socketIds = getReceiverSocketId(uid.toString());
    if (!socketIds) return;
    const ids = Array.isArray(socketIds) ? socketIds : [socketIds];
    ids.forEach((socketId) => io.to(socketId).emit(event, payload));
  });
};

/**
 * Edit the text of a message. Only the original sender may edit, and only
 * messages that have not been deleted. Broadcasts MESSAGE_EDITED in real time.
 * Requires authentication middleware.
 * @param {Object} req - params: { id: messageId }, body: { text }
 * @param {Object} res - Response object
 * @returns {void} Returns the updated message
 */
export const editMessage = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const { text } = req.body;
    const userId = req.user._id;
    const trimmedText = typeof text === "string" ? text.trim() : "";

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message id" });
    }
    if (!trimmedText) {
      return res.status(400).json({ message: "Message text cannot be empty" });
    }
    if (trimmedText.length > MAX_MESSAGE_TEXT_LENGTH) {
      return res.status(400).json({ message: "Message text is too long" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    // SECURITY: only the sender may edit their own message.
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "You can only edit your own messages" });
    }
    if (message.isDeleted) {
      return res.status(400).json({ message: "Cannot edit a deleted message" });
    }

    message.text = trimmedText;
    message.isEdited = true;
    message.editedAt = new Date();
    await message.save();

    // Drop stale cache so refetches see the edit.
    messageCache.invalidateChat(message.senderId, message.receiverId);

    res.status(200).json(message);

    emitToParticipants([message.senderId, message.receiverId], SOCKET_EVENTS.MESSAGE_EDITED, {
      messageId: message._id,
      text: message.text,
      isEdited: true,
      editedAt: message.editedAt,
    });
  } catch (error) {
    console.log("Error in editMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Soft-delete a message. Only the original sender may delete. The document is
 * kept but its content is cleared and isDeleted flips to true. Broadcasts
 * MESSAGE_DELETED in real time. Requires authentication middleware.
 * @param {Object} req - params: { id: messageId }
 * @param {Object} res - Response object
 * @returns {void} Returns the updated (soft-deleted) message
 */
export const deleteMessage = async (req, res) => {
  try {
    const { id: messageId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return res.status(400).json({ message: "Invalid message id" });
    }

    const message = await Message.findById(messageId);
    if (!message) {
      return res.status(404).json({ message: "Message not found" });
    }
    // SECURITY: only the sender may delete their own message.
    if (message.senderId.toString() !== userId.toString()) {
      return res.status(403).json({ message: "You can only delete your own messages" });
    }

    // Idempotent: deleting an already-deleted message just returns it.
    if (!message.isDeleted) {
      message.isDeleted = true;
      message.deletedAt = new Date();
      message.text = "";
      message.image = null;
      message.file = null;
      await message.save();
      messageCache.invalidateChat(message.senderId, message.receiverId);
    }

    res.status(200).json(message);

    emitToParticipants([message.senderId, message.receiverId], SOCKET_EVENTS.MESSAGE_DELETED, {
      messageId: message._id,
    });
  } catch (error) {
    console.log("Error in deleteMessage controller: ", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
