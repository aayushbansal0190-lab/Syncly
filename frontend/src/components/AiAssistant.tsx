import { useEffect, useState } from "react";
import { Sparkles, X, Copy, Loader2, FileText, MessageSquare, Search, Send } from "lucide-react";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { getErrorMessage } from "../lib/error";
import { useChatStore } from "../store/useChatStore";

type Mode = "summary" | "reply" | "ask";

// Popover of AI actions for the open conversation. All LLM calls happen
// server-side; this component only talks to our own API.
const AiAssistant = () => {
  const { selectedUser } = useChatStore();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState<Mode | null>(null);
  const [result, setResult] = useState("");
  const [title, setTitle] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [askQuery, setAskQuery] = useState("");

  // Close the popover AND wipe any previous result, so reopening always starts
  // fresh instead of showing a stale summary/reply.
  const closePanel = () => {
    setOpen(false);
    setResult("");
    setTitle("");
    setAskOpen(false);
    setAskQuery("");
  };

  // Also clear a shown result when the conversation changes — a summary of one
  // chat shouldn't linger when you open a different chat.
  useEffect(() => {
    setResult("");
    setTitle("");
    setAskOpen(false);
    setAskQuery("");
  }, [selectedUser?._id]);

  if (!selectedUser) return null;

  // Summarize / suggest-reply run on the whole conversation.
  const run = async (mode: "summary" | "reply") => {
    setLoading(mode);
    setResult("");
    setTitle(mode === "summary" ? "Conversation summary" : "Suggested reply");
    const path = mode === "summary" ? "summarize" : "suggest-reply";
    try {
      const res = await axiosInstance.post(`/ai/${path}/${selectedUser._id}`);
      setResult(res.data.result ?? "");
    } catch (error) {
      toast.error(getErrorMessage(error, "AI request failed"));
      setTitle("");
    } finally {
      setLoading(null);
    }
  };

  // Ask a standalone question (a quick "search" without leaving the chat).
  const runAsk = async () => {
    const q = askQuery.trim();
    if (!q) return;
    setLoading("ask");
    setResult("");
    setTitle("Answer");
    try {
      const res = await axiosInstance.post("/ai/ask", { question: q });
      setResult(res.data.result ?? "");
    } catch (error) {
      toast.error(getErrorMessage(error, "AI request failed"));
      setTitle("");
    } finally {
      setLoading(null);
    }
  };

  const copy = async () => {
    await navigator.clipboard.writeText(result);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="relative">
      <div className="tooltip tooltip-bottom" data-tip="AI assistant">
        <button
          onClick={() => (open ? closePanel() : setOpen(true))}
          className="btn btn-ghost btn-sm btn-circle"
        >
          <Sparkles className="size-5" />
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 max-w-[90vw] z-30 bg-base-100 border border-base-300 rounded-xl shadow-lg p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-1.5 font-medium text-sm">
              <Sparkles className="size-4 text-primary" /> AI assistant
            </span>
            <button className="btn btn-ghost btn-xs btn-circle" onClick={closePanel}>
              <X className="size-4" />
            </button>
          </div>

          {/* Vertical action list */}
          <div className="flex flex-col gap-1.5">
            <button
              className="btn btn-sm btn-primary justify-start gap-2"
              onClick={() => run("summary")}
              disabled={loading !== null}
            >
              {loading === "summary" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileText className="size-4" />
              )}
              Summarize chat
            </button>

            <button
              className="btn btn-sm btn-outline justify-start gap-2"
              onClick={() => run("reply")}
              disabled={loading !== null}
            >
              {loading === "reply" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <MessageSquare className="size-4" />
              )}
              Suggest a reply
            </button>

            <button
              className={`btn btn-sm justify-start gap-2 ${askOpen ? "btn-secondary" : "btn-outline"}`}
              onClick={() => setAskOpen((o) => !o)}
              disabled={loading !== null}
            >
              <Search className="size-4" />
              Ask AI
            </button>
          </div>

          {/* Ask AI input (revealed by the "Ask AI" button) */}
          {askOpen && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                runAsk();
              }}
              className="mt-2 flex gap-1"
            >
              <input
                autoFocus
                value={askQuery}
                onChange={(e) => setAskQuery(e.target.value)}
                placeholder="Ask anything…"
                className="input input-sm input-bordered flex-1"
              />
              <button
                type="submit"
                className="btn btn-sm btn-primary btn-square"
                disabled={loading !== null || !askQuery.trim()}
              >
                {loading === "ask" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
              </button>
            </form>
          )}

          {result && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium text-base-content/60">{title}</span>
                <button className="btn btn-ghost btn-xs gap-1" onClick={copy}>
                  <Copy className="size-3" /> Copy
                </button>
              </div>
              <div className="text-sm bg-base-200 rounded-lg p-2 max-h-60 overflow-y-auto whitespace-pre-wrap">
                {result}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
export default AiAssistant;
