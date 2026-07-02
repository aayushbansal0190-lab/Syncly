// Cookie and Authentication
export const COOKIE_NAME = "jwt";

// Socket Event Names
export const SOCKET_EVENTS = {
  GET_ONLINE_USERS: "getOnlineUsers",
  NEW_MESSAGE: "newMessage",
  MESSAGE_RECEIVED: "messageReceived",
  MESSAGE_SEEN: "messageSeen",
  MESSAGE_EDITED: "messageEdited",
  MESSAGE_DELETED: "messageDeleted",
  // Friend-request live updates: pushed to the receiver when a request arrives,
  // and to the original sender when their request is accepted.
  FRIEND_REQUEST: "friendRequest",
  FRIEND_REQUEST_ACCEPTED: "friendRequestAccepted",
  // WebRTC video-call signaling (the server only relays these between peers).
  CALL_OFFER: "call:offer",
  CALL_ANSWER: "call:answer",
  CALL_ICE: "call:ice",
  CALL_REJECT: "call:reject",
  CALL_END: "call:end",
  CALL_UNAVAILABLE: "call:unavailable",
};
