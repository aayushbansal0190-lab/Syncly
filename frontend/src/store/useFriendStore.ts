import { create } from "zustand";
import toast from "react-hot-toast";
import { axiosInstance } from "../lib/axios";
import { useChatStore } from "./useChatStore";
import { getErrorMessage } from "../lib/error";
import type { FriendRequest, User } from "../types";

interface FriendStore {
  pendingRequests: FriendRequest[];
  isLoadingRequests: boolean;
  getPendingRequests: () => Promise<void>;
  acceptRequest: (requestId: string) => Promise<void>;
  addIncomingRequest: (request: FriendRequest) => void;
  onRequestAccepted: (byUser?: User) => void;
  rejectRequest: (requestId: string) => Promise<void>;
}

// Manages incoming friend requests (the piece that was missing — without it,
// users could send requests but no one could accept them, so no one could chat).
export const useFriendStore = create<FriendStore>((set, get) => ({
  pendingRequests: [],
  isLoadingRequests: false,

  /** Load friend requests addressed to the logged-in user. */
  getPendingRequests: async () => {
    set({ isLoadingRequests: true });
    try {
      const res = await axiosInstance.get("/friends/requests/pending");
      set({ pendingRequests: res.data });
    } catch (error) {
      // Non-critical (the section just stays empty); log for debugging.
      console.error("Failed to load friend requests:", getErrorMessage(error));
    } finally {
      set({ isLoadingRequests: false });
    }
  },

  /** Accept a request, then refresh the sidebar so the new friend appears. */
  acceptRequest: async (requestId) => {
    try {
      await axiosInstance.put(`/friends/request/${requestId}/accept`);
      set({ pendingRequests: get().pendingRequests.filter((r) => r._id !== requestId) });
      toast.success("Friend request accepted");
      // The new friend should now show up in the chat sidebar.
      useChatStore.getState().getUsers();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to accept request"));
    }
  },

  /**
   * Handle a friend request that arrived in real time over the socket.
   * Prepends it to the pending list (deduped) and toasts the user.
   */
  addIncomingRequest: (request) => {
    if (!request?._id) return;
    const exists = get().pendingRequests.some((r) => r._id === request._id);
    if (exists) return;
    set({ pendingRequests: [request, ...get().pendingRequests] });
    const name = request.sender?.fullName || request.sender?.username || "Someone";
    toast(`New friend request from ${name}`);
  },

  /**
   * Handle the socket event fired when someone accepts a request WE sent.
   * The new friend won't be in our sidebar yet, so refresh it.
   */
  onRequestAccepted: (byUser) => {
    useChatStore.getState().getUsers();
    const name = byUser?.fullName || byUser?.username || "Your request";
    toast.success(`${name} accepted your friend request`);
  },

  /** Reject (delete) a request. */
  rejectRequest: async (requestId) => {
    try {
      await axiosInstance.delete(`/friends/request/${requestId}/reject`);
      set({ pendingRequests: get().pendingRequests.filter((r) => r._id !== requestId) });
      toast.success("Request rejected");
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to reject request"));
    }
  },
}));
