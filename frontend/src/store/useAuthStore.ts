import { create } from "zustand";
import { io, type Socket } from "socket.io-client";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { SOCKET_EVENTS } from "../constants";
import { requestNotificationPermission } from "../lib/notifications";
import { useFriendStore } from "./useFriendStore";
import { getErrorMessage } from "../lib/error";
import type { FriendRequest, User } from "../types";

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "/";

type SocketStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "error";

interface SignupData {
  fullName: string;
  email: string;
  password: string;
  username?: string;
}

interface LoginData {
  email: string;
  password: string;
}

interface AuthStore {
  authUser: User | null;
  isSigningUp: boolean;
  isLoggingIn: boolean;
  isUpdatingProfile: boolean;
  isCheckingAuth: boolean;
  onlineUsers: string[];
  socket: Socket | null;
  socketStatus: SocketStatus;
  checkAuth: () => Promise<void>;
  signup: (data: SignupData) => Promise<void>;
  login: (data: LoginData) => Promise<void>;
  logout: () => Promise<void>;
  updateProfile: (data: { profilePic: string }) => Promise<void>;
  connectSocket: () => void;
  disconnectSocket: () => void;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  authUser: null,
  isSigningUp: false,
  isLoggingIn: false,
  isUpdatingProfile: false,
  isCheckingAuth: true,
  onlineUsers: [],
  socket: null,
  socketStatus: "disconnected",

  /** Check if the user is already authenticated on page load. */
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

  /** Create a new account and authenticate. */
  signup: async (data) => {
    set({ isSigningUp: true });
    try {
      const res = await axiosInstance.post("/auth/signup", data);
      set({ authUser: res.data });
      toast.success("Account created successfully");
      get().connectSocket();
    } catch (error) {
      toast.error(getErrorMessage(error, "Signup failed"));
    } finally {
      set({ isSigningUp: false });
    }
  },

  /** Authenticate with email + password. */
  login: async (data) => {
    set({ isLoggingIn: true });
    try {
      const res = await axiosInstance.post("/auth/login", data);
      set({ authUser: res.data });
      toast.success("Logged in successfully");

      get().connectSocket();
    } catch (error) {
      toast.error(getErrorMessage(error, "Login failed"));
    } finally {
      set({ isLoggingIn: false });
    }
  },

  /** Clear auth and disconnect the socket. */
  logout: async () => {
    try {
      await axiosInstance.post("/auth/logout");
      set({ authUser: null });
      toast.success("Logged out successfully");
      get().disconnectSocket();
    } catch (error) {
      toast.error(getErrorMessage(error, "Logout failed"));
    }
  },

  /** Upload a new profile picture (base64 data URL). */
  updateProfile: async (data) => {
    set({ isUpdatingProfile: true });
    try {
      const res = await axiosInstance.put("/auth/update-profile", data);
      set({ authUser: res.data });
      toast.success("Profile updated successfully");
    } catch (error) {
      console.log("error in update profile:", error);
      toast.error(getErrorMessage(error, "Profile update failed"));
    } finally {
      set({ isUpdatingProfile: false });
    }
  },

  /** Establish the Socket.io connection and wire up real-time listeners. */
  connectSocket: () => {
    const { authUser } = get();
    const existingSocket = get().socket;

    if (!authUser) return;

    // Ask for desktop-notification permission once the user is authenticated.
    requestNotificationPermission();

    if (existingSocket) {
      if (!existingSocket.connected) {
        set({ socketStatus: "reconnecting" });
        existingSocket.connect();
      }

      return;
    }

    const socket = io(SOCKET_URL, {
      path: "/socket.io",
      withCredentials: true,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      timeout: 20000,
      transports: ["websocket", "polling"],
    });

    socket.on("connect", () => {
      set({ socketStatus: "connected" });
    });

    socket.on("disconnect", (reason) => {
      if (reason !== "io client disconnect") {
        set({ socketStatus: "reconnecting", onlineUsers: [] });
      } else {
        set({ socketStatus: "disconnected", onlineUsers: [] });
      }
    });

    socket.on("connect_error", (error) => {
      console.log("Socket connect error:", error.message);
      set({ socketStatus: "error" });
    });

    socket.io.on("reconnect_attempt", () => {
      set({ socketStatus: "reconnecting" });
    });

    socket.io.on("reconnect", () => {
      set({ socketStatus: "connected" });
    });

    socket.io.on("reconnect_error", () => {
      set({ socketStatus: "error" });
    });

    socket.io.on("reconnect_failed", () => {
      set({ socketStatus: "disconnected" });
    });

    socket.on(SOCKET_EVENTS.GET_ONLINE_USERS, (userIds: string[]) => {
      set({ onlineUsers: userIds });
    });

    // Live friend-request updates (bound here so they work on any page).
    socket.on(SOCKET_EVENTS.FRIEND_REQUEST, (request: FriendRequest) => {
      useFriendStore.getState().addIncomingRequest(request);
    });

    socket.on(SOCKET_EVENTS.FRIEND_REQUEST_ACCEPTED, (data: { by?: User }) => {
      useFriendStore.getState().onRequestAccepted(data?.by);
    });

    set({ socket, socketStatus: "connecting" });

    socket.connect();
  },

  /** Disconnect the socket and clean up listeners (called on logout). */
  disconnectSocket: () => {
    const socket = get().socket;
    if (socket?.connected) {
      socket.off(SOCKET_EVENTS.GET_ONLINE_USERS);
      socket.off(SOCKET_EVENTS.FRIEND_REQUEST);
      socket.off(SOCKET_EVENTS.FRIEND_REQUEST_ACCEPTED);
      socket.disconnect();
    }
    set({ socket: null, onlineUsers: [], socketStatus: "disconnected" });
  },
}));
