import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  searchUsers,
  sendFriendRequest,
  getPendingRequests,
  acceptFriendRequest,
  rejectFriendRequest,
  getFriends,
  checkFriendship,
} from "../controllers/friend.controller.js";

const router = express.Router();

// Search for users by username
router.get("/search", protectRoute, searchUsers);

// Get current user's friends
router.get("/list", protectRoute, getFriends);

// Get pending friend requests for current user
router.get("/requests/pending", protectRoute, getPendingRequests);

// Check if two users are friends
router.get("/check/:userId", protectRoute, checkFriendship);

// Send friend request
router.post("/request/send", protectRoute, sendFriendRequest);

// Accept friend request
router.put("/request/:requestId/accept", protectRoute, acceptFriendRequest);

// Reject friend request
router.delete("/request/:requestId/reject", protectRoute, rejectFriendRequest);

export default router;
