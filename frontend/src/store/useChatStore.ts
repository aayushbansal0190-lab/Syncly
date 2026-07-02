import { create } from "zustand";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { SOCKET_EVENTS } from "../constants";
import { showMessageNotification } from "../lib/notifications";
import { getErrorMessage } from "../lib/error";
import type { Message, MessageStatus, OutgoingMessage, User } from "../types";

// Server ids arrive as strings, but a few code paths may hold a populated object;
// this coerces either into a plain string id for safe comparison.
const normalizeId = (value: string | { _id?: string } | null | undefined): string => {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value._id) return String(value._id);
  return String(value);
};

const createTempMessageId = (): string => {
  if (globalThis.crypto?.randomUUID) {
    return `temp_${globalThis.crypto.randomUUID()}`;
  }

  return `temp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
};

interface ChatStore {
  messages: Message[];
  messagesByUser: Record<string, Message[]>;
  users: User[];
  selectedUser: User | null;
  isUsersLoading: boolean;
  isMessagesLoading: boolean;
  isSendingMessage: boolean;
  isLoadingMoreMessages: boolean;
  hasMoreMessages: boolean;
  socket: Socket | null;
  currentPage: number;
  messageLimit: number;
  activeMessagesRequestId: number;
  getUsers: () => Promise<void>;
  getMessages: (userId: string, page?: number) => Promise<void>;
  prefetchMessages: (userId: string) => Promise<void>;
  loadMoreMessages: () => Promise<void>;
  sendMessage: (messageData: OutgoingMessage) => Promise<void>;
  editMessage: (messageId: string, newText: string) => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  searchMessages: (userId: string, query: string) => Promise<Message[]>;
  subscribeToMessages: () => void;
  updateMessageStatus: (messageId: string, status: MessageStatus) => void;
  unsubscribeFromMessages: () => void;
  setSelectedUser: (selectedUser: User | null) => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  messagesByUser: {},
  users: [],
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isSendingMessage: false,
  isLoadingMoreMessages: false,
  hasMoreMessages: true,
  socket: null,
  currentPage: 1,
  messageLimit: 50,
  activeMessagesRequestId: 0,

  /** Fetch all friends for the sidebar (excludes the logged-in user). */
  getUsers: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/users");
      set({ users: res.data });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load users"));
    } finally {
      set({ isUsersLoading: false });
    }
  },

  /** Fetch messages with a given user, paginated (newest page is 1). */
  getMessages: async (userId, page = 1) => {
    const { messageLimit } = get();
    const isFirstLoad = page === 1;
    const cachedForUser = get().messagesByUser[userId];
    const requestId = get().activeMessagesRequestId + 1;
    set({ activeMessagesRequestId: requestId });

    if (isFirstLoad) {
      // Show previously loaded messages instantly while we refresh in background.
      if (cachedForUser?.length) {
        set({ messages: cachedForUser, currentPage: 1, isMessagesLoading: false, hasMoreMessages: true });
      } else {
        set({ isMessagesLoading: true, currentPage: 1, messages: [], hasMoreMessages: true });
      }
    } else {
      set({ isLoadingMoreMessages: true });
    }

    try {
      const res = await axiosInstance.get(`/messages/${userId}?page=${page}&limit=${messageLimit}`);
      const { messages: newMessages } = res.data;
      const hasMore = res.data.hasMore ?? newMessages.length >= messageLimit;
      const { selectedUser, activeMessagesRequestId } = get();
      const isStaleRequest = requestId !== activeMessagesRequestId;
      const isDifferentChat = String(selectedUser?._id) !== String(userId);

      // Ignore stale or out-of-order responses so one chat cannot overwrite another.
      if (isStaleRequest || (isFirstLoad && isDifferentChat)) {
        return;
      }

      if (isFirstLoad) {
        set((state) => ({
          messages: newMessages,
          currentPage: page,
          hasMoreMessages: hasMore,
          messagesByUser: {
            ...state.messagesByUser,
            [userId]: newMessages,
          },
        }));
      } else {
        // Prepend older messages when loading more
        const mergedMessages = [...newMessages, ...get().messages];
        set((state) => ({
          messages: mergedMessages,
          currentPage: page,
          hasMoreMessages: hasMore,
          messagesByUser: {
            ...state.messagesByUser,
            [userId]: mergedMessages,
          },
        }));
      }
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load messages"));
    } finally {
      if (isFirstLoad) {
        set({ isMessagesLoading: false });
      } else {
        set({ isLoadingMoreMessages: false });
      }
    }
  },

  /** Prefetch first-page messages on hover for a faster chat open. */
  prefetchMessages: async (userId) => {
    const { messageLimit } = get();
    if (!userId) return;
    if (get().messagesByUser[userId]?.length) return;
    try {
      const res = await axiosInstance.get(`/messages/${userId}?page=1&limit=${messageLimit}`);
      const prefetchedMessages = res.data?.messages || [];
      set((state) => ({
        messagesByUser: {
          ...state.messagesByUser,
          [userId]: prefetchedMessages,
        },
      }));
    } catch {
      // Prefetch is best-effort only.
    }
  },

  /** Load the next older page of messages for the open chat. */
  loadMoreMessages: async () => {
    const { selectedUser, currentPage, isLoadingMoreMessages, hasMoreMessages } = get();
    if (!selectedUser || isLoadingMoreMessages || !hasMoreMessages) return;

    const nextPage = currentPage + 1;
    await get().getMessages(selectedUser._id, nextPage);
  },

  /**
   * Send a message to the selected user with an OPTIMISTIC UPDATE: the message
   * appears instantly, then the server response replaces the temp one (or it's
   * rolled back on failure).
   */
  sendMessage: async (messageData) => {
    set({ isSendingMessage: true });
    const { selectedUser } = get();
    const authUser = useAuthStore.getState().authUser;
    if (!selectedUser?._id || !authUser) {
      set({ isSendingMessage: false });
      return;
    }

    const targetUserId = selectedUser._id;
    const tempMessageId = createTempMessageId();

    try {
      // Create temporary message for optimistic update
      const tempMessage: Message = {
        _id: tempMessageId,
        text: messageData.text,
        image: messageData.image || null,
        // Optimistically show the file using its local data URL; the server
        // response will swap in the hosted Cloudinary url.
        file: messageData.file
          ? {
              url: messageData.file.data,
              name: messageData.file.name,
              type: messageData.file.type,
              size: messageData.file.size,
            }
          : null,
        senderId: authUser._id,
        receiverId: targetUserId,
        status: "sent",
        createdAt: new Date(),
      };

      // Show message immediately (OPTIMISTIC UPDATE) ⚡
      const optimisticMessages = [...get().messages, tempMessage];
      set((state) => ({
        messages: optimisticMessages,
        messagesByUser: {
          ...state.messagesByUser,
          [targetUserId]: optimisticMessages,
        },
      }));

      // Send to server in background
      const res = await axiosInstance.post(`/messages/send/${targetUserId}`, messageData);

      // Replace temp message with real message from server (use CURRENT state, not stale)
      const activeChatMessages = get().messages;
      const cachedTargetMessages = get().messagesByUser[targetUserId] || activeChatMessages;
      const updatedTargetMessages = cachedTargetMessages.map((msg) =>
        msg._id === tempMessageId ? (res.data as Message) : msg
      );
      const isStillSelected = String(get().selectedUser?._id) === String(targetUserId);
      set((state) => ({
        messages: isStillSelected ? updatedTargetMessages : state.messages,
        messagesByUser: {
          ...state.messagesByUser,
          [targetUserId]: updatedTargetMessages,
        },
      }));
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to send message"));
      // Remove optimistic message on error (use stored temp ID)
      const activeChatMessages = get().messages;
      const cachedTargetMessages = get().messagesByUser[targetUserId] || activeChatMessages;
      const revertedTargetMessages = cachedTargetMessages.filter((msg) => msg._id !== tempMessageId);
      const isStillSelected = String(get().selectedUser?._id) === String(targetUserId);
      set((state) => ({
        messages: isStillSelected ? revertedTargetMessages : state.messages,
        messagesByUser: {
          ...state.messagesByUser,
          [targetUserId]: revertedTargetMessages,
        },
      }));
    } finally {
      set({ isSendingMessage: false });
    }
  },

  /**
   * Edit the text of one of your own messages. Optimistic, reverts on failure.
   */
  editMessage: async (messageId, newText) => {
    const trimmed = (newText || "").trim();
    if (!trimmed) return;

    const { selectedUser, messages } = get();
    const previousMessages = messages;

    const optimisticMessages = messages.map((msg): Message =>
      String(msg._id) === String(messageId)
        ? { ...msg, text: trimmed, isEdited: true }
        : msg
    );
    set((state) => ({
      messages: optimisticMessages,
      messagesByUser: selectedUser
        ? { ...state.messagesByUser, [selectedUser._id]: optimisticMessages }
        : state.messagesByUser,
    }));

    try {
      await axiosInstance.patch(`/messages/${messageId}`, { text: trimmed });
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to edit message"));
      // Roll back to the pre-edit state on failure.
      set((state) => ({
        messages: previousMessages,
        messagesByUser: selectedUser
          ? { ...state.messagesByUser, [selectedUser._id]: previousMessages }
          : state.messagesByUser,
      }));
    }
  },

  /**
   * Soft-delete one of your own messages. Optimistic, reverts on failure.
   */
  deleteMessage: async (messageId) => {
    const { selectedUser, messages } = get();
    const previousMessages = messages;

    const optimisticMessages = messages.map((msg): Message =>
      String(msg._id) === String(messageId)
        ? { ...msg, isDeleted: true, text: "", image: null, file: null }
        : msg
    );
    set((state) => ({
      messages: optimisticMessages,
      messagesByUser: selectedUser
        ? { ...state.messagesByUser, [selectedUser._id]: optimisticMessages }
        : state.messagesByUser,
    }));

    try {
      await axiosInstance.delete(`/messages/${messageId}`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to delete message"));
      set((state) => ({
        messages: previousMessages,
        messagesByUser: selectedUser
          ? { ...state.messagesByUser, [selectedUser._id]: previousMessages }
          : state.messagesByUser,
      }));
    }
  },

  /**
   * Search messages within the conversation with a given user. Returns the
   * matches to the caller; the search UI keeps its own local state.
   */
  searchMessages: async (userId, query) => {
    const q = (query || "").trim();
    if (!q || !userId) return [];
    try {
      const res = await axiosInstance.get(
        `/messages/search/${userId}?q=${encodeURIComponent(q)}`
      );
      return res.data.results || [];
    } catch (error) {
      toast.error(getErrorMessage(error, "Search failed"));
      return [];
    }
  },

  /**
   * Subscribe to real-time message events for the open chat. Removes old
   * listeners first so we never double-subscribe.
   */
  subscribeToMessages: () => {
    const { selectedUser } = get();
    if (!selectedUser) return;

    const socket = useAuthStore.getState().socket;
    if (!socket) return; // Guard against null socket

    set({ socket });

    // Remove old listeners first to prevent duplicates
    socket.off(SOCKET_EVENTS.NEW_MESSAGE);
    socket.off(SOCKET_EVENTS.MESSAGE_SEEN);
    socket.off(SOCKET_EVENTS.MESSAGE_RECEIVED);
    socket.off(SOCKET_EVENTS.MESSAGE_EDITED);
    socket.off(SOCKET_EVENTS.MESSAGE_DELETED);

    socket.on(SOCKET_EVENTS.NEW_MESSAGE, (newMessage: Message) => {
      const senderId = normalizeId(newMessage.senderId);

      // Desktop notification for ANY incoming message (even from a chat that
      // isn't currently open). The helper itself no-ops if the app is focused or
      // permission wasn't granted. We look the sender up in our friends list for
      // a friendly title.
      const sender = get().users.find((u) => normalizeId(u._id) === senderId);
      showMessageNotification({
        title: sender?.fullName || sender?.username || "New message",
        body: newMessage.text || (newMessage.image ? "📷 Photo" : "New message"),
        icon: sender?.profilePic,
      });

      const activeSelectedUser = get().selectedUser;
      if (!activeSelectedUser) return;

      const activeSelectedUserId = normalizeId(activeSelectedUser._id);
      const isMessageSentFromSelectedUser = senderId === activeSelectedUserId;
      if (!isMessageSentFromSelectedUser) return;

      const currentMessages = get().messages;
      // Prevent duplicate messages by checking if message already exists
      const messageExists = currentMessages.some(
        (msg) => normalizeId(msg._id) === normalizeId(newMessage._id)
      );
      if (!messageExists) {
        const updatedMessages = [...currentMessages, newMessage];
        set((state) => ({
          messages: updatedMessages,
          messagesByUser: {
            ...state.messagesByUser,
            [activeSelectedUser._id]: updatedMessages,
          },
        }));
      }
    });

    // Listen for message seen status updates
    socket.on(SOCKET_EVENTS.MESSAGE_SEEN, (data: { messageId: string }) => {
      const { messageId } = data;
      const { selectedUser } = get();
      const updatedMessages = get().messages.map((msg): Message =>
        String(msg._id) === String(messageId) ? { ...msg, status: "seen" } : msg
      );
      set((state) => ({
        messages: updatedMessages,
        messagesByUser: selectedUser
          ? { ...state.messagesByUser, [selectedUser._id]: updatedMessages }
          : state.messagesByUser,
      }));
    });

    // Listen for message delivered status updates
    socket.on(
      SOCKET_EVENTS.MESSAGE_RECEIVED,
      (data: { messageId: string; status?: MessageStatus }) => {
        const { messageId, status } = data;
        const { selectedUser } = get();
        const updatedMessages = get().messages.map((msg): Message =>
          String(msg._id) === String(messageId) ? { ...msg, status: status || "received" } : msg
        );
        set((state) => ({
          messages: updatedMessages,
          messagesByUser: selectedUser
            ? { ...state.messagesByUser, [selectedUser._id]: updatedMessages }
            : state.messagesByUser,
        }));
      }
    );

    // Listen for real-time edits from the other user (or your own other tabs)
    socket.on(
      SOCKET_EVENTS.MESSAGE_EDITED,
      (data: { messageId: string; text: string; isEdited?: boolean; editedAt?: string }) => {
        const { messageId, text, isEdited, editedAt } = data;
        const { selectedUser } = get();
        const updatedMessages = get().messages.map((msg): Message =>
          String(msg._id) === String(messageId)
            ? { ...msg, text, isEdited: isEdited ?? true, editedAt }
            : msg
        );
        set((state) => ({
          messages: updatedMessages,
          messagesByUser: selectedUser
            ? { ...state.messagesByUser, [selectedUser._id]: updatedMessages }
            : state.messagesByUser,
        }));
      }
    );

    // Listen for real-time deletes; mark the message as deleted locally
    socket.on(SOCKET_EVENTS.MESSAGE_DELETED, (data: { messageId: string }) => {
      const { messageId } = data;
      const { selectedUser } = get();
      const updatedMessages = get().messages.map((msg): Message =>
        String(msg._id) === String(messageId)
          ? { ...msg, isDeleted: true, text: "", image: null, file: null }
          : msg
      );
      set((state) => ({
        messages: updatedMessages,
        messagesByUser: selectedUser
          ? { ...state.messagesByUser, [selectedUser._id]: updatedMessages }
          : state.messagesByUser,
      }));
    });
  },

  /** Update a single message's status in local state (e.g. on "seen"). */
  updateMessageStatus: (messageId, status) => {
    const { selectedUser } = get();
    const updatedMessages = get().messages.map((msg): Message =>
      String(msg._id) === String(messageId) ? { ...msg, status } : msg
    );
    set((state) => ({
      messages: updatedMessages,
      messagesByUser: selectedUser
        ? { ...state.messagesByUser, [selectedUser._id]: updatedMessages }
        : state.messagesByUser,
    }));
  },

  /** Remove all message socket listeners (on chat change or logout). */
  unsubscribeFromMessages: () => {
    const socket = useAuthStore.getState().socket;
    if (socket) {
      socket.off(SOCKET_EVENTS.NEW_MESSAGE);
      socket.off(SOCKET_EVENTS.MESSAGE_SEEN);
      socket.off(SOCKET_EVENTS.MESSAGE_RECEIVED);
      socket.off(SOCKET_EVENTS.MESSAGE_EDITED);
      socket.off(SOCKET_EVENTS.MESSAGE_DELETED);
    }
  },

  /** Set the currently open conversation. */
  setSelectedUser: (selectedUser) => set({ selectedUser }),
}));
