// UI Theme Options (DaisyUI themes)
export const THEMES = [
  "light",
  "dark",
  "cupcake",
  "bumblebee",
  "emerald",
  "corporate",
  "synthwave",
  "retro",
  "cyberpunk",
  "valentine",
  "halloween",
  "garden",
  "forest",
  "aqua",
  "lofi",
  "pastel",
  "fantasy",
  "wireframe",
  "black",
  "luxury",
  "dracula",
  "cmyk",
  "autumn",
  "business",
  "acid",
  "lemonade",
  "night",
  "coffee",
  "winter",
  "dim",
  "nord",
  "sunset",
] as const;

// A valid DaisyUI theme name, derived straight from the THEMES list above.
export type Theme = (typeof THEMES)[number];

// Socket Event Names. `as const` makes each value a string literal type (e.g.
// "newMessage" rather than just string), so event names can't be mistyped.
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
} as const;

// Union of every socket event string, for typing emit/on calls.
export type SocketEvent = (typeof SOCKET_EVENTS)[keyof typeof SOCKET_EVENTS];
