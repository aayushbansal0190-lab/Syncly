import { useChatStore } from "../store/useChatStore";
import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, Search, X, FileText, Sparkles } from "lucide-react";
import toast from "react-hot-toast";

import ChatHeader from "./ChatHeader";
import MessageInput from "./MessageInput";
import MessageSkeleton from "./skeletons/MessageSkeleton";
import { useAuthStore } from "../store/useAuthStore";
import { axiosInstance } from "../lib/axios";
import { getErrorMessage } from "../lib/error";
import { formatMessageTime } from "../lib/utils";
import { SOCKET_EVENTS } from "../constants";
import type { Message } from "../types";

const normalizeId = (value: string | { _id?: string } | null | undefined): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

// Human-readable file size for the attachment chip.
const formatFileSize = (bytes?: number): string => {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ChatContainer = () => {
  const {
    messages,
    getMessages,
    isMessagesLoading,
    isLoadingMoreMessages,
    hasMoreMessages,
    selectedUser,
    subscribeToMessages,
    unsubscribeFromMessages,
    socket,
    updateMessageStatus,
    loadMoreMessages,
    editMessage,
    deleteMessage,
    searchMessages,
  } = useChatStore();
  const { authUser, socket: authSocket } = useAuthStore();
  const messageEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  // IDs we've already reported as "seen" this session. Kept in a ref (not state)
  // so it survives re-renders and effect re-runs, letting us fire the socket
  // event exactly once per message instead of on every intersection/re-render.
  const seenIdsRef = useRef<Set<string>>(new Set());
  const messageContainerRef = useRef<HTMLDivElement>(null);
  const lastScrollHeight = useRef(0);
  const wasLoadingMoreRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  // Track which message (if any) is currently being edited inline, and its draft text.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  const startEdit = (message: Message) => {
    setEditingId(message._id);
    setEditText(message.text || "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const submitEdit = (messageId: string) => {
    if (!editText.trim()) return;
    editMessage(messageId, editText);
    cancelEdit();
  };

  const handleDelete = (messageId: string) => {
    if (window.confirm("Delete this message? This cannot be undone.")) {
      deleteMessage(messageId);
    }
  };

  // In-conversation search. showSearch toggles the search bar; searchResults is
  // null when not searching, or an array of matches once a search has run.
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Message[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const closeSearch = () => {
    setShowSearch(false);
    setSearchQuery("");
    setSearchResults(null);
  };

  // Jump to a matched message if it's currently loaded in the list.
  const jumpToMessage = (messageId: string) => {
    const ref = messageRefs.current[messageId];
    if (ref) {
      ref.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    closeSearch();
  };

  // Message selection for the AI actions: the user ticks specific messages, then
  // Summarize / Suggest reply run on only those (via messageIds to the backend).
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [aiResult, setAiResult] = useState<{ title: string; text: string } | null>(null);
  const [aiLoading, setAiLoading] = useState<"summarize" | "suggest-reply" | null>(null);

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelectedIds(new Set());

  const runSelectionAi = async (kind: "summarize" | "suggest-reply") => {
    if (!selectedUser || selectedIds.size === 0) return;
    setAiLoading(kind);
    try {
      const res = await axiosInstance.post(`/ai/${kind}/${selectedUser._id}`, {
        messageIds: Array.from(selectedIds),
      });
      setAiResult({
        title: kind === "summarize" ? "Summary of selected" : "Suggested reply",
        text: res.data.result ?? "",
      });
    } catch (error) {
      toast.error(getErrorMessage(error, "AI request failed"));
    } finally {
      setAiLoading(null);
    }
  };

  // Bulk-delete selected messages. You can only delete your OWN messages (same
  // rule as the single-message delete), so we filter the selection to yours and
  // tell the user how many were skipped.
  const deleteSelected = async () => {
    const deletable = Array.from(selectedIds).filter((id) => {
      const m = messages.find((x) => x._id === id);
      return m && !m.isDeleted && normalizeId(m.senderId) === normalizeId(authUser?._id);
    });

    if (deletable.length === 0) {
      toast.error("You can only delete your own messages.");
      return;
    }

    const skipped = selectedIds.size - deletable.length;
    const plural = deletable.length > 1 ? "s" : "";
    const skipNote = skipped > 0 ? ` (${skipped} not yours will be skipped)` : "";
    if (!window.confirm(`Delete ${deletable.length} message${plural}?${skipNote} This cannot be undone.`)) {
      return;
    }

    await Promise.all(deletable.map((id) => deleteMessage(id)));
    clearSelection();
  };

  // Reset search + selection whenever the open conversation changes.
  useEffect(() => {
    closeSearch();
    setSelectedIds(new Set());
    setAiResult(null);
  }, [selectedUser?._id]);

  // Live (debounced) search: runs as the user types. We wait 300ms after the
  // last keystroke before calling the API, so typing a word fires ONE request
  // instead of one per letter. The `ignore` flag drops any in-flight result
  // whose query is already out of date (prevents out-of-order/stale results).
  useEffect(() => {
    if (!showSearch) return;
    const q = searchQuery.trim();
    if (!q || !selectedUser?._id) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    let ignore = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      const results = await searchMessages(selectedUser._id, q);
      if (!ignore) {
        setSearchResults(results);
        setIsSearching(false);
      }
    }, 300);

    // Cleanup runs on the next keystroke (or close): cancel the pending timer
    // and mark any in-flight request as stale.
    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [searchQuery, showSearch, selectedUser?._id, searchMessages]);

  // Intersection Observer: report an incoming message as "seen" the first time
  // it becomes visible — and only once per message.
  useEffect(() => {
    const myId = normalizeId(authUser?._id);
    const seen = seenIdsRef.current;

    // Pre-seed with incoming messages that are already "seen" (e.g. loaded from
    // history), so we never re-report them on mount.
    messages.forEach((m) => {
      if (m.status === "seen" && normalizeId(m.senderId) !== myId) seen.add(m._id);
    });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;

          const messageId = entry.target.getAttribute("data-message-id");
          const senderId = entry.target.getAttribute("data-sender-id");
          if (!messageId || !socket) return;

          // Only the receiver marks a message seen, and only once. The ref Set
          // guard is what breaks the old feedback loop: updateMessageStatus
          // mutates `messages` and re-runs this effect, but an already-recorded
          // id is skipped instead of re-emitting.
          const isIncoming = senderId !== myId;
          if (!isIncoming || seen.has(messageId)) return;

          seen.add(messageId);
          socket.emit(SOCKET_EVENTS.MESSAGE_SEEN, { messageId });
          updateMessageStatus(messageId, "seen");
          observer.unobserve(entry.target); // seen — stop watching it
        });
      },
      { threshold: 0.7 }
    );

    Object.values(messageRefs.current).forEach((ref) => {
      if (ref) observer.observe(ref);
    });

    return () => observer.disconnect();
  }, [messages, authUser, socket, updateMessageStatus]);

  // Infinite scroll - detect when scrolling near top
  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const currentTop = container.scrollTop;
      const isScrollingUp = currentTop < lastScrollTopRef.current;
      lastScrollTopRef.current = currentTop;

      // If scrolled near top (within 100px) and not already loading
      if (
        isScrollingUp &&
        currentTop < 100 &&
        !isLoadingMoreMessages &&
        hasMoreMessages &&
        container.scrollHeight > container.clientHeight
      ) {
        lastScrollHeight.current = container.scrollHeight;
        loadMoreMessages();
      }
    };

    container.addEventListener("scroll", handleScroll);
    return () => container.removeEventListener("scroll", handleScroll);
  }, [isLoadingMoreMessages, hasMoreMessages, loadMoreMessages]);

  // Maintain scroll position when loading more messages
  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container) return;

    // When older-page loading finishes, preserve viewport position.
    if (wasLoadingMoreRef.current && !isLoadingMoreMessages) {
      const newScrollHeight = container.scrollHeight;
      const heightDifference = newScrollHeight - lastScrollHeight.current;
      container.scrollTop = Math.max(0, heightDifference);
    }
    wasLoadingMoreRef.current = isLoadingMoreMessages;
  }, [messages, isLoadingMoreMessages]);

  useEffect(() => {
    if (!selectedUser?._id) return;
    // Load current chat messages whenever selected user changes.
    getMessages(selectedUser._id);

    // Subscribe as soon as socket is available (handles late socket connect race).
    if (authSocket) {
      subscribeToMessages();
    }

    return () => unsubscribeFromMessages();
  }, [selectedUser?._id, authSocket, getMessages, subscribeToMessages, unsubscribeFromMessages]);

  useEffect(() => {
    const container = messageContainerRef.current;
    if (!container || isLoadingMoreMessages) return;

    // Keep chat pinned to bottom for regular/new messages.
    container.scrollTop = container.scrollHeight;
  }, [messages, isLoadingMoreMessages]);

  // Only rendered with an open chat and an authenticated user; this guard makes
  // that explicit to TypeScript (all hooks above run unconditionally first).
  if (!authUser || !selectedUser) return null;

  if (isMessagesLoading) {
    return (
      <div className="flex-1 flex flex-col overflow-auto">
        <ChatHeader searchOpen={false} onToggleSearch={() => setShowSearch(true)} />
        <MessageSkeleton />
        <MessageInput />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-auto relative">
      <ChatHeader
        searchOpen={showSearch}
        onToggleSearch={() => (showSearch ? closeSearch() : setShowSearch(true))}
      />

      {/* Search input bar: shown only while searching (toggled from the header,
          so it no longer occupies a permanent row of its own). */}
      {showSearch && (
        <div className="border-b border-base-300 px-4 py-2 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 opacity-50" />
            <input
              type="text"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search in this conversation..."
              className="input input-sm input-bordered w-full pl-9"
            />
            {/* Live spinner: shows while a debounced request is in flight. */}
            {isSearching && (
              <span className="loading loading-spinner loading-xs absolute right-3 top-1/2 -translate-y-1/2" />
            )}
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost btn-circle"
            onClick={closeSearch}
            title="Close search"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Search results: click a match to jump to it (if it's loaded). */}
      {showSearch && searchResults !== null && (
        <div className="border-b border-base-300 max-h-60 overflow-y-auto bg-base-200">
          {searchResults.length === 0 ? (
            <p className="text-sm opacity-60 p-3">No matches found.</p>
          ) : (
            <ul className="divide-y divide-base-300">
              {searchResults.map((result) => (
                <li key={result._id}>
                  <button
                    className="w-full text-left p-3 hover:bg-base-300 transition"
                    onClick={() => jumpToMessage(result._id)}
                  >
                    <span className="text-sm">{result.text}</span>
                    <span className="block text-xs opacity-50 mt-1">
                      {formatMessageTime(result.createdAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div ref={messageContainerRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Loading more indicator */}
        {isLoadingMoreMessages && (
          <div className="flex justify-center py-2">
            <div className="loading loading-spinner loading-sm"></div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message._id}
            ref={(ref) => {
              messageRefs.current[message._id] = ref;
            }}
            data-message-id={message._id}
            data-sender-id={normalizeId(message.senderId)}
            className={`chat ${normalizeId(message.senderId) === normalizeId(authUser._id) ? "chat-end" : "chat-start"}`}
          >
            <div className=" chat-image avatar">
              <div className="size-10 rounded-full border">
                <img
                  src={
                    normalizeId(message.senderId) === normalizeId(authUser._id)
                      ? authUser.profilePic || "/avatar.png"
                      : selectedUser.profilePic || "/avatar.png"
                  }
                  alt="profile pic"
                />
              </div>
            </div>
            <div className="chat-header mb-1 flex items-center gap-1.5">
              {/* Select this message for the AI actions (only text messages —
                  images/deleted have nothing for the model to read). */}
              {message.text && !message.isDeleted && (
                <button
                  type="button"
                  onClick={() => toggleSelect(message._id)}
                  title="Select for AI"
                  className={`size-3.5 rounded-full border flex items-center justify-center transition-colors ${
                    selectedIds.has(message._id)
                      ? "bg-primary border-primary text-primary-content"
                      : "border-base-content/30 hover:border-primary"
                  }`}
                >
                  {selectedIds.has(message._id) && <Check className="size-2.5" />}
                </button>
              )}
              <time className="text-xs opacity-50">
                {formatMessageTime(message.createdAt)}
              </time>
            </div>
            <div
              className={`chat-bubble flex flex-col group relative ${
                selectedIds.has(message._id) ? "ring-2 ring-primary ring-offset-1 ring-offset-base-100" : ""
              }`}
            >
              {message.isDeleted ? (
                // Tombstone for a soft-deleted message.
                <p className="italic opacity-60">This message was deleted</p>
              ) : editingId === message._id ? (
                // Inline edit mode: textarea + Save/Cancel.
                <div className="flex flex-col gap-2">
                  <textarea
                    className="textarea textarea-bordered text-sm text-base-content min-w-[220px]"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    rows={2}
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end">
                    <button className="btn btn-xs" onClick={cancelEdit}>
                      Cancel
                    </button>
                    <button
                      className="btn btn-xs btn-primary"
                      onClick={() => submitEdit(message._id)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {message.image && (
                    <img
                      src={message.image}
                      alt="Attachment"
                      className="sm:max-w-[200px] rounded-md mb-2"
                    />
                  )}
                  {message.file?.url &&
                    (message.file.type?.startsWith("audio/") ? (
                      // Voice note: play inline instead of offering a download.
                      <audio controls src={message.file.url} className="mb-1 h-10 max-w-[240px]" />
                    ) : (
                      <a
                        href={message.file.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        download={message.file.name}
                        className="flex items-center gap-2 p-2 mb-1 rounded-md bg-base-100/40 hover:bg-base-100/70 transition max-w-[240px]"
                      >
                        <FileText className="w-5 h-5 shrink-0" />
                        <span className="flex flex-col overflow-hidden">
                          <span className="text-sm truncate">{message.file.name}</span>
                          {message.file.size > 0 && (
                            <span className="text-[10px] opacity-60">
                              {formatFileSize(message.file.size)}
                            </span>
                          )}
                        </span>
                      </a>
                    ))}
                  {message.text && <p>{message.text}</p>}
                  {message.isEdited && (
                    <span className="text-[10px] opacity-50 mt-1">(edited)</span>
                  )}

                  {/* Message Status Indicator (only for sent messages) */}
                  {normalizeId(message.senderId) === normalizeId(authUser._id) && (
                    <div
                      className={`flex items-center gap-1 mt-1 text-xs ${
                        message.status === "seen" ? "text-blue-500" :
                        message.status === "received" ? "text-gray-400" :
                        "text-gray-300"
                      }`}
                    >
                      <Check className="w-3 h-3" />
                      {(message.status === "received" || message.status === "seen") && (
                        <Check className="w-3 h-3" />
                      )}
                    </div>
                  )}
                </>
              )}

              {/* Edit/Delete controls: only on your own, non-deleted messages,
                  and hidden while that message is being edited. Appear on hover. */}
              {normalizeId(message.senderId) === normalizeId(authUser._id) &&
                !message.isDeleted &&
                editingId !== message._id && (
                  <div className="absolute -top-3 right-1 hidden group-hover:flex gap-1">
                    {message.text && (
                      <button
                        className="btn btn-xs btn-circle"
                        onClick={() => startEdit(message)}
                        title="Edit"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                    <button
                      className="btn btn-xs btn-circle"
                      onClick={() => handleDelete(message._id)}
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
            </div>
          </div>
        ))}
        <div ref={messageEndRef} />
      </div>

      {/* Floating action bar: appears while messages are selected. Runs the AI
          on exactly those messages. */}
      {selectedIds.size > 0 && (
        <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1 bg-base-100 border border-base-300 rounded-full shadow-lg px-2 py-1">
          <span className="text-xs px-2 font-medium">{selectedIds.size} selected</span>
          <button
            className="btn btn-xs btn-primary gap-1"
            disabled={aiLoading !== null}
            onClick={() => runSelectionAi("summarize")}
          >
            {aiLoading === "summarize" ? (
              <span className="loading loading-spinner loading-xs" />
            ) : (
              <Sparkles className="size-3" />
            )}
            Summarize
          </button>
          <button
            className="btn btn-xs gap-1"
            disabled={aiLoading !== null}
            onClick={() => runSelectionAi("suggest-reply")}
          >
            {aiLoading === "suggest-reply" ? (
              <span className="loading loading-spinner loading-xs" />
            ) : null}
            Reply
          </button>
          <button
            className="btn btn-xs btn-error btn-outline gap-1"
            disabled={aiLoading !== null}
            onClick={deleteSelected}
            title="Delete your selected messages"
          >
            <Trash2 className="size-3" />
            Delete
          </button>
          <button
            className="btn btn-xs btn-ghost btn-circle"
            onClick={clearSelection}
            title="Clear selection"
          >
            <X className="size-3" />
          </button>
        </div>
      )}

      {/* AI result modal (shared by summarize + suggest reply on selection). */}
      {aiResult && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 p-4"
          onClick={() => setAiResult(null)}
        >
          <div
            className="bg-base-100 rounded-xl border border-base-300 shadow-xl max-w-md w-full p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-medium flex items-center gap-1.5">
                <Sparkles className="size-4 text-primary" />
                {aiResult.title}
              </h3>
              <button
                className="btn btn-ghost btn-xs btn-circle"
                onClick={() => setAiResult(null)}
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="text-sm whitespace-pre-wrap max-h-80 overflow-y-auto bg-base-200 rounded-lg p-3">
              {aiResult.text}
            </div>
          </div>
        </div>
      )}

      <MessageInput />
    </div>
  );
};
export default ChatContainer;
