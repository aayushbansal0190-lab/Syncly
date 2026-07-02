import Groq from "groq-sdk";

// The model used for all AI features. Groq serves open models for free and very
// fast. Swap this (and the client below) to change providers — nothing else in
// the app needs to change.
export const AI_MODEL = "llama-3.3-70b-versatile";

let client;

// Lazily construct the client so env vars are loaded first, and so the server
// still boots (and every non-AI feature works) even with no key set — the AI
// endpoints just return a clear 503 until GROQ_API_KEY is added. The SDK reads
// GROQ_API_KEY from the environment itself.
const getClient = () => {
  if (!process.env.GROQ_API_KEY) {
    const err = new Error("AI is not configured: missing GROQ_API_KEY");
    err.statusCode = 503;
    throw err;
  }
  if (!client) client = new Groq();
  return client;
};

// Provider-agnostic text generation. Controllers only depend on this function —
// switching Groq for another provider is a change to THIS file alone. Groq
// uses the OpenAI-style chat.completions API (system + user messages).
export const generateText = async ({ system, prompt, maxTokens = 1024 }) => {
  const groq = getClient();
  const completion = await groq.chat.completions.create({
    model: AI_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });
  return completion.choices[0]?.message?.content?.trim() ?? "";
};
