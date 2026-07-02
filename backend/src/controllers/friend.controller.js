import FriendRequest from "../models/friendRequest.model.js";
import User from "../models/user.model.js";
import { getReceiverSocketId, io } from "../lib/socket.js";
import { SOCKET_EVENTS } from "../constants.js";

// Escape regex metacharacters so a user's search text is treated as a literal
// string (prevents regex injection / ReDoS via crafted input like ".*").
const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Push a socket event to every live socket of a single user (multi-tab safe).
// No-ops silently if the target user is offline.
const emitToUser = (userId, event, payload) => {
  const socketIds = getReceiverSocketId(userId.toString());
  if (!socketIds) return;
  const ids = Array.isArray(socketIds) ? socketIds : [socketIds];
  ids.forEach((socketId) => io.to(socketId).emit(event, payload));
};

/**
 * Search for users by username
 * Returns users with pagination, excludes current user
 * @param {Object} req - Query params: { query, limit }
 * @param {Object} res - Response object
 * @returns {void} Returns array of matching users
 */
export const searchUsers = async (req, res) => {
  try {
    const { query = "", limit = 10 } = req.query;
    const userId = req.user._id;
    const searchLimit = Math.min(Number(limit) || 10, 50);

    if (!query.trim()) {
      return res.status(400).json({ message: "Search query required" });
    }

    const safeQuery = escapeRegex(query.trim());

    const users = await User.find({
      $and: [
        { _id: { $ne: userId } },
        {
          $or: [
            { username: { $regex: safeQuery, $options: "i" } },
            { fullName: { $regex: safeQuery, $options: "i" } },
          ],
        },
      ],
    })
      .select("_id username fullName profilePic")
      .limit(searchLimit)
      .lean();

    // Annotate each result with the caller's relationship to that user, so the
    // client can show the right action (Add / Sent / Accept / Friends) instead
    // of a blind send button. One query covers every result.
    const otherIds = users.map((u) => u._id);
    const relations = await FriendRequest.find({
      status: { $in: ["pending", "accepted"] },
      $or: [
        { sender: userId, receiver: { $in: otherIds } },
        { sender: { $in: otherIds }, receiver: userId },
      ],
    }).lean();

    // Map otherUserId -> status. If several records exist, keep the strongest
    // (friends > received > sent) so the UI shows the most relevant action.
    const rank = { sent: 1, received: 2, friends: 3 };
    const statusByUser = {};
    for (const rel of relations) {
      const isSender = rel.sender.toString() === userId.toString();
      const otherId = (isSender ? rel.receiver : rel.sender).toString();
      const status = rel.status === "accepted" ? "friends" : isSender ? "sent" : "received";
      if (!statusByUser[otherId] || rank[status] > rank[statusByUser[otherId]]) {
        statusByUser[otherId] = status;
      }
    }

    const results = users.map((u) => ({
      ...u,
      status: statusByUser[u._id.toString()] || "none",
    }));

    res.status(200).json(results);
  } catch (error) {
    console.error("Error in searchUsers:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Send friend request to a user by username
 * @param {Object} req - Request body: { receiverUsername }
 * @param {Object} res - Response object
 * @returns {void} Returns created friend request or error
 */
export const sendFriendRequest = async (req, res) => {
  try {
    const { receiverUsername } = req.body;
    const senderId = req.user._id;

    if (!receiverUsername) {
      return res.status(400).json({ message: "Receiver username required" });
    }

    const receiver = await User.findOne({ username: receiverUsername.toLowerCase() });
    if (!receiver) {
      return res.status(404).json({ message: "User not found" });
    }

    if (receiver._id.toString() === senderId.toString()) {
      return res.status(400).json({ message: "Cannot send request to yourself" });
    }

    // Check if request already exists (pending or accepted)
    const existingRequest = await FriendRequest.findOne({
      $or: [
        { sender: senderId, receiver: receiver._id },
        { sender: receiver._id, receiver: senderId },
      ],
    });

    if (existingRequest) {
      return res.status(400).json({
        message:
          existingRequest.status === "accepted"
            ? "Already friends"
            : `Friend request already ${existingRequest.status}`,
      });
    }

    const friendRequest = new FriendRequest({
      sender: senderId,
      receiver: receiver._id,
    });

    await friendRequest.save();
    await friendRequest.populate("sender receiver", "_id username fullName profilePic");

    res.status(201).json(friendRequest);

    // Notify the receiver in real time so the request shows up without a reload.
    emitToUser(receiver._id, SOCKET_EVENTS.FRIEND_REQUEST, friendRequest);
  } catch (error) {
    console.error("Error in sendFriendRequest:", error.message);
    if (error.code === 11000) {
      return res.status(400).json({ message: "Friend request already sent" });
    }
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get all pending friend requests for current user
 * @param {Object} req - Express request
 * @param {Object} res - Response object
 * @returns {void} Returns array of pending requests
 */
export const getPendingRequests = async (req, res) => {
  try {
    const userId = req.user._id;

    const requests = await FriendRequest.find({
      receiver: userId,
      status: "pending",
    })
      .populate("sender", "_id username fullName profilePic")
      .sort({ createdAt: -1 })
      .lean();

    res.status(200).json(requests);
  } catch (error) {
    console.error("Error in getPendingRequests:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Accept a friend request
 * @param {Object} req - Request params: { requestId }
 * @param {Object} res - Response object
 * @returns {void} Returns updated friend request
 */
export const acceptFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user._id;

    const request = await FriendRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.receiver.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not authorized to accept this request" });
    }

    request.status = "accepted";
    await request.save();
    await request.populate("sender receiver", "_id username fullName profilePic");

    res.status(200).json(request);

    // Tell the original sender their request was accepted so their sidebar
    // picks up the new friend live (the accepter already refreshes their own).
    emitToUser(request.sender._id, SOCKET_EVENTS.FRIEND_REQUEST_ACCEPTED, {
      request,
      by: request.receiver,
    });
  } catch (error) {
    console.error("Error in acceptFriendRequest:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Reject a friend request
 * @param {Object} req - Request params: { requestId }
 * @param {Object} res - Response object
 * @returns {void} Returns success message or error
 */
export const rejectFriendRequest = async (req, res) => {
  try {
    const { requestId } = req.params;
    const userId = req.user._id;

    const request = await FriendRequest.findById(requestId);
    if (!request) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (request.receiver.toString() !== userId.toString()) {
      return res.status(403).json({ message: "Not authorized to reject this request" });
    }

    await FriendRequest.deleteOne({ _id: requestId });

    res.status(200).json({ message: "Request rejected" });
  } catch (error) {
    console.error("Error in rejectFriendRequest:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Get list of friends (accepted requests)
 * @param {Object} req - Express request
 * @param {Object} res - Response object
 * @returns {void} Returns array of friends
 */
export const getFriends = async (req, res) => {
  try {
    const userId = req.user._id;

    // Get all accepted friend requests where user is sender or receiver
    const friendRequests = await FriendRequest.find({
      $or: [{ sender: userId }, { receiver: userId }],
      status: "accepted",
    })
      .populate({
        path: "sender",
        select: "_id username fullName profilePic",
      })
      .populate({
        path: "receiver",
        select: "_id username fullName profilePic",
      })
      .lean();

    // Extract friend objects (the other user in each request)
    const friends = friendRequests.map((request) => {
      if (request.sender._id.toString() === userId.toString()) {
        return request.receiver;
      } else {
        return request.sender;
      }
    });

    res.status(200).json(friends);
  } catch (error) {
    console.error("Error in getFriends:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};

/**
 * Check if two users are friends
 * @param {Object} req - Request params: { userId }
 * @param {Object} res - Response object
 * @returns {void} Returns friendship status
 */
export const checkFriendship = async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user._id;

    const friendship = await FriendRequest.findOne({
      $or: [
        { sender: currentUserId, receiver: userId },
        { sender: userId, receiver: currentUserId },
      ],
      status: "accepted",
    }).lean();

    res.status(200).json({ isFriend: !!friendship });
  } catch (error) {
    console.error("Error in checkFriendship:", error.message);
    res.status(500).json({ error: "Internal server error" });
  }
};
