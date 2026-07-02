import { create } from "zustand";
import { axiosInstance } from "../lib/axios.js";
import toast from "react-hot-toast";
import { io } from "socket.io-client";
import { SOCKET_EVENTS } from "../constants.js";

export const useAuthStore = create((set, get) => ({
  authUser: null,
  isSigningUp: false,
  isLoggingIn: false,
  isUpdatingProfile: false,
  isCheckingAuth: true,
  onlineUsers: [],
  socket: null,

  /**
   * Check if user is already authenticated on page load
   * @returns {Promise<void>}
   */
  checkAuth: async () => {
    try {
      const res = await axiosInstance.get("/auth/check");

      set({ authUser: res.data });
      get().connectSocket();
    } catch (error) {
      console.log("Error in checkAuth:", error);
      set({ authUser: null });
    } finally {
      set({ isCheckingAuth: false });
    }
  },

  /**
   * Handle user signup - Create new account and authenticate
   * @param {Object} data - User data: { fullName, email, password }
   * @returns {Promise<void>}
   */
  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      toast.success("Account created successfully");
      get().connectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isSigningUp: false });
    }
  },

  /**
   * Handle user login - Authenticate with credentials
   * @param {Object} data - Login data: { email, password }
   * @returns {Promise<void>}
   */
  login: async (data) => {
    set({ isLoggingIn: true });
    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data });
      toast.success("Logged in successfully");

      get().connectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    } finally {
      set({ isLoggingIn: false });
    }
  },

  /**
   * Handle user logout - Clear auth and disconnect socket
   * @returns {Promise<void>}
   */
  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
      set({ authUser: null });
      toast.success("Logged out successfully");
      get().disconnectSocket();
    } catch (error) {
      toast.error(error.response.data.message);
    }
  },

  /**
   * Update user profile picture
   * @param {Object} data - Profile data: { profilePic (base64) }
   * @returns {Promise<void>}
   */
  updateProfile: async (data) => {
    set({ isUpdatingProfile: true });
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data });
      toast.success("Profile updated successfully");
    } catch (error) {
      console.log("error in update profile:", error);
      toast.error(error.response.data.message);
    } finally {
      set({ isUpdatingProfile: false });
    }
  },

  /**
   * Establish Socket.io connection for real-time updates
   * Listens for online users updates
   * @returns {void}
   */
  connectSocket: () => {
    const { authUser } = get();
    if (!authUser || get().socket?.connected) return;

    const socket = io("/", {
      path: "/socket.io",
      query: {
        userId: authUser._id,
      },
    });
    socket.connect();

    set({ socket: socket });

    socket.on(SOCKET_EVENTS.GET_ONLINE_USERS, (userIds) => {
      set({ onlineUsers: userIds });
    });
  },
  /**
   * Disconnect Socket.io connection and cleanup listeners
   * Called on user logout
   * @returns {void}
   */
  disconnectSocket: () => {
    if (get().socket?.connected) {
      get().socket.off(SOCKET_EVENTS.GET_ONLINE_USERS);
      get().socket.disconnect();
    }
  },
}));
