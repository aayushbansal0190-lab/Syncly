import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useAuthStore } from "./useAuthStore";
import { SOCKET_EVENTS } from "../constants.js";

export const useChatStore = create((set, get) => ({
  messages: [],
  users: [],
  selectedUser: null,
  isUsersLoading: false,
  isMessagesLoading: false,
  isSendingMessage: false,

  /**
   * Fetch all available users for the sidebar
   * Excludes the currently logged-in user
   * @returns {Promise<void>}
   */
  getUsers: async () => {
    set({ isUsersLoading: true });
    try {
      const res = await axiosInstance.get("/messages/users");
      set({ users: res.data });
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isUsersLoading: false });
    }
  },

  /**
   * Fetch all messages between logged-in user and selected user
   * @param {string} userId - The user ID to fetch messages with
   * @returns {Promise<void>}
   */
  getMessages: async (userId) => {
    set({ isMessagesLoading: true });
    try {
      const res = await axiosInstance.get(`/messages/${userId}`);
      set({ messages: res.data });
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isMessagesLoading: false });
    }
  },
  /**
   * Send a message to the selected user
   * @param {Object} messageData - Message content: { text, image }
   * @returns {Promise<void>}
   */
  sendMessage: async (messageData) => {
    set({isSendingMessage: true });
    const { selectedUser, messages } = get();
    try {
      const res = await axiosInstance.post(`/messages/send/${selectedUser._id}`, messageData);
      set({ messages: [...messages, res.data] });
    } catch (error) {
      toast.error(error.response.data.message);
    }
    finally{
      set({isSendingMessage: false })
    }
  },

  /**
   * Subscribe to new messages from selected user via Socket.io
   * Listens for real-time message events
   * @returns {void}
   */
  subscribeToMessages: () => {
    const { selectedUser } = get();
    if (!selectedUser) return;

    const socket = useAuthStore.getState().socket;

    socket.on(SOCKET_EVENTS.NEW_MESSAGE, (newMessage) => {
      const isMessageSentFromSelectedUser = newMessage.senderId === selectedUser._id;
      if (!isMessageSentFromSelectedUser) return;

      set({
        messages: [...get().messages, newMessage],
      });
    });
  },

  /**
   * Unsubscribe from message socket events
   * Called when changing users or logging out
   * @returns {void}
   */
  unsubscribeFromMessages: () => {
    const socket = useAuthStore.getState().socket;
    socket.off(SOCKET_EVENTS.NEW_MESSAGE);
  },

  /**
   * Set the currently selected user for chatting
   * @param {Object} selectedUser - User object to chat with
   * @returns {void}
   */
  setSelectedUser: (selectedUser) => set({ selectedUser }),
}));
