import Message from "../models/message.model.js";
import User from "../models/user.model.js";
import { generateText } from "../lib/ai.js";

// Build a plain-text transcript of the recent conversation between the logged-in
// user and `otherId`, oldest-first, so the model can read it like a script.
// Only text messages are included (images/files/deleted messages are skipped).
const buildTranscript = async (meId, otherId, { limit = 100, messageIds } = {}) => {
  const [me, other] = await Promise.all([
    User.findById(meId).select("fullName").lean(),
    User.findById(otherId).select("fullName").lean(),
  ]);
  if (!me || !other) return null;

  // Always scope to THIS conversation. When the client passes specific
  // messageIds (the user hand-picked messages), we additionally constrain to
  // those — but keep the conversation filter so a user can't feed in message IDs
  // from a chat they aren't part of.
  const convoFilter = {
    isDeleted: { $ne: true },
    $or: [
      { senderId: meId, receiverId: otherId },
      { senderId: otherId, receiverId: meId },
    ],
  };

  let messages;
  if (Array.isArray(messageIds) && messageIds.length > 0) {
    // Only the selected messages, in chronological order.
    messages = await Message.find({ ...convoFilter, _id: { $in: messageIds } })
      .sort({ createdAt: 1 })
      .lean();
  } else {
    // Fallback: the MOST RECENT `limit` messages (newest-first + limit), then
    // reversed back to chronological order so the transcript reads top-to-bottom.
    messages = await Message.find(convoFilter).sort({ createdAt: -1 }).limit(limit).lean();
    messages.reverse();
  }

  const lines = messages
    .filter((m) => m.text)
    .map((m) => {
      const who = m.senderId.toString() === meId.toString() ? me.fullName : other.fullName;
      return `${who}: ${m.text}`;
    });

  return { transcript: lines.join("\n"), me, other, count: lines.length };
};

// Shared error handling for the AI endpoints: a missing key surfaces as a clean
// 503 (feature not configured) rather than a scary 500.
const handleAiError = (res, error) => {
  console.error("AI error:", error?.message);
  const status = error?.statusCode || error?.status || 500;
  if (status === 503) {
    return res.status(503).json({ message: "AI features are not configured on the server." });
  }
  return res.status(500).json({ message: "AI request failed. Please try again." });
};

// POST /api/ai/summarize/:id — summarize the conversation with user :id.
export const summarizeConversation = async (req, res) => {
  try {
    const data = await buildTranscript(req.user._id, req.params.id, {
      messageIds: req.body?.messageIds,
    });
    if (!data) return res.status(404).json({ message: "User not found" });
    if (data.count === 0) {
      return res.json({ result: "There are no messages to summarize yet." });
    }

    const text = await generateText({
      maxTokens: 1024,
      system:
        "You summarize a two-person chat. First, under a 'Summary' heading, give 2-5 concise bullet points capturing the key topics, any decisions made, and open questions or action items. Be neutral and factual.\n\n" +
        "Then fact-check what was said: if any statement is clearly and objectively factually incorrect (e.g. a wrong date, a wrong definition, or a well-known fact stated wrong), add a section headed '⚠️ Possible inaccuracies' with one bullet per issue in the form \"<what was said> → <the correct fact>\". Only flag clear, objective errors — never opinions, plans, preferences, or subjective statements — and be conservative: if you are not confident a statement is wrong, do not flag it. If there are no clear inaccuracies, omit this section entirely.",
      prompt: `Summarize this conversation between ${data.me.fullName} and ${data.other.fullName}:\n\n${data.transcript}`,
    });

    res.json({ result: text });
  } catch (error) {
    handleAiError(res, error);
  }
};

// POST /api/ai/suggest-reply/:id — draft a reply the logged-in user could send.
export const suggestReply = async (req, res) => {
  try {
    // A reply only needs the recent thread, not the whole history. Using a small
    // window (last 15 messages) keeps the draft anchored to the CURRENT topic
    // instead of mixing in older, unrelated conversations. If the user hand-picked
    // messages, those are used instead (via messageIds).
    const data = await buildTranscript(req.user._id, req.params.id, {
      limit: 15,
      messageIds: req.body?.messageIds,
    });
    if (!data) return res.status(404).json({ message: "User not found" });
    if (data.count === 0) {
      return res.json({ result: "Start the conversation first, then I can suggest replies." });
    }

    const text = await generateText({
      maxTokens: 300,
      system:
        `You are helping ${data.me.fullName} reply in a friendly one-on-one chat with ${data.other.fullName}. ` +
        `Focus on the MOST RECENT message and the current topic — ignore older, unrelated parts of the chat. ` +
        `Draft a single natural reply message that ${data.me.fullName} could send next, matching the tone of the conversation. ` +
        `Output only the message text — no quotes, no preamble, no options.`,
      prompt: `Here are the latest messages:\n\n${data.transcript}\n\nWrite ${data.me.fullName}'s reply to the most recent message.`,
    });

    res.json({ result: text });
  } catch (error) {
    handleAiError(res, error);
  }
};

// POST /api/ai/ask — answer a free-form question so the user can look something
// up without leaving the chat. Answers from the model's knowledge (not live web),
// so it's for general/how-to questions, not real-time facts.
export const askAi = async (req, res) => {
  try {
    const question = typeof req.body?.question === "string" ? req.body.question.trim() : "";
    if (!question) return res.status(400).json({ message: "Question is required" });
    if (question.length > 1000) return res.status(400).json({ message: "Question is too long" });

    const text = await generateText({
      maxTokens: 700,
      system:
        "You are a concise, helpful assistant embedded in a chat app. Answer the user's question directly and briefly. " +
        "If the answer could have changed recently or you're unsure, say so rather than guessing.",
      prompt: question,
    });

    res.json({ result: text });
  } catch (error) {
    handleAiError(res, error);
  }
};
