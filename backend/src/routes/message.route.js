import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import {
  deleteMessage,
  editMessage,
  getMessages,
  getUsersForSidebar,
  searchMessages,
  sendMessage,
} from "../controllers/message.controller.js";

const router = express.Router();

router.get("/users", protectRoute, getUsersForSidebar);
// Search within a conversation. Defined BEFORE GET /:id so the literal "search"
// segment isn't captured as an :id.
router.get("/search/:id", protectRoute, searchMessages);
router.get("/:id", protectRoute, getMessages);

router.post("/send/:id", protectRoute, sendMessage);

// Edit/delete a single message. Here :id is the MESSAGE id (not a user id).
// These use PATCH/DELETE verbs, so they never clash with GET /:id above.
router.patch("/:id", protectRoute, editMessage);
router.delete("/:id", protectRoute, deleteMessage);

export default router;
