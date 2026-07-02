// Shared domain types for the whole frontend. These mirror the backend Mongoose
// models and the JSON they serialize to, so every store/component agrees on the
// shape of a user, a message, and a friend request.

export interface User {
  _id: string;
  fullName: string;
  email: string;
  username: string;
  profilePic: string;
  createdAt?: string;
  updatedAt?: string;
}

// A message's delivery state. Using a union (not just `string`) means a typo like
// "recieved" is a compile error instead of a silent runtime bug.
export type MessageStatus = "sent" | "received" | "seen";

export interface FileAttachment {
  url: string;
  name: string;
  type: string;
  size: number;
}

export interface Message {
  _id: string;
  // Server sends these as string ids; helpers also tolerate populated objects.
  senderId: string;
  receiverId: string;
  text?: string;
  image?: string | null;
  file?: FileAttachment | null;
  status: MessageStatus;
  isEdited?: boolean;
  editedAt?: string | null;
  isDeleted?: boolean;
  deletedAt?: string | null;
  // Real messages carry an ISO string; optimistic temp ones use a Date.
  createdAt: string | Date;
  updatedAt?: string;
}

export type FriendRequestStatus = "pending" | "accepted" | "rejected";

export interface FriendRequest {
  _id: string;
  sender: User;
  receiver: User;
  status: FriendRequestStatus;
  createdAt: string;
}

// What the composer hands to sendMessage (image/file are base64 data URLs).
export interface OutgoingMessage {
  text: string;
  image?: string | null;
  file?: {
    data: string;
    name: string;
    type: string;
    size: number;
  } | null;
}
