import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { summarizeConversation, suggestReply, askAi } from "../controllers/ai.controller.js";

const router = express.Router();

// Auth-protected. summarize/suggest-reply read a private conversation (`:id` is
// the other user's id), so only a logged-in participant may call them. `ask` is a
// standalone question and needs no conversation.
router.post("/summarize/:id", protectRoute, summarizeConversation);
router.post("/suggest-reply/:id", protectRoute, suggestReply);
router.post("/ask", protectRoute, askAi);

export default router;
