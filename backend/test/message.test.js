import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import Message from "../src/models/message.model.js";
import User from "../src/models/user.model.js";
import FriendRequest from "../src/models/friendRequest.model.js";
import { messageCache } from "../src/lib/message-cache.js";

vi.mock("../src/lib/cloudinary.js", () => ({
  default: {
    uploader: {
      upload: vi.fn(),
    },
  },
}));

vi.mock("../src/lib/socket.js", () => ({
  io: { to: vi.fn(), emit: vi.fn() },
  getReceiverSocketId: vi.fn(),
  app: {},
  server: {},
}));

const mockRequest = (overrides = {}) => ({
  body: {},
  params: {},
  user: {},
  cookies: {},
  ...overrides,
});

const mockResponse = () => {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    cookie: vi.fn().mockReturnThis(),
    clearCookie: vi.fn().mockReturnThis(),
  };

  return res;
};

describe("message flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    messageCache.clear();
  });

  it("rejects invalid user id in getMessages", async () => {
    const { getMessages } = await import("../src/controllers/message.controller.js");

    const userId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: "not-an-object-id" },
      query: {},
      user: { _id: userId },
    });
    const res = mockResponse();

    await getMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid user id" });
  });

  it("rejects message send when receiver and sender are the same", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    const userId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: userId.toString() },
      body: { text: "hello", image: "" },
      user: { _id: userId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "You cannot message yourself",
    });
  });

  it("rejects message send with no text or image", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: { text: "", image: "" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Message must contain text, image, or file",
    });
  });

  it("rejects message send when receiver does not exist", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    vi.spyOn(User, "exists").mockResolvedValue(false);

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: { text: "hello", image: "" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Receiver not found" });
  });

  it("rejects message send with text exceeding max length", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    vi.spyOn(User, "exists").mockResolvedValue(true);

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const longText = "x".repeat(5000);

    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: { text: longText, image: "" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Message text is too long",
    });
  });

  it("rejects message with invalid image format", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    vi.spyOn(User, "exists").mockResolvedValue(true);

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: { text: "", image: "not-a-data-url" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Image must be a valid image data URL",
    });
  });

  it("creates and caches messages on getMessages", async () => {
    const { getMessages } = await import("../src/controllers/message.controller.js");

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const mockMessages = [
      {
        _id: new mongoose.Types.ObjectId(),
        senderId,
        receiverId,
        text: "hello",
        image: null,
        status: "seen",
        createdAt: new Date(),
      },
    ];

    vi.spyOn(Message, "find").mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(mockMessages),
          }),
        }),
      }),
    });

    const req = mockRequest({
      params: { id: receiverId.toString() },
      query: { page: "1", limit: "50" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await getMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const call = res.json.mock.calls[0][0];
    expect(call.messages).toEqual(mockMessages);
    expect(call.hasMore).toBe(false);
    expect(call.page).toBe(1);
    expect(call.limit).toBe(50);
    expect(call.cached).toBe(false);
  });

  it("returns paginated messages with proper limits", async () => {
    const { getMessages } = await import("../src/controllers/message.controller.js");

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();

    const mockMessages = Array.from({ length: 50 }, (_, i) => ({
      _id: new mongoose.Types.ObjectId(),
      senderId: i % 2 === 0 ? senderId : receiverId,
      receiverId: i % 2 === 0 ? receiverId : senderId,
      text: `message ${i}`,
      image: null,
      status: "received",
      createdAt: new Date(Date.now() - i * 1000),
    }));

    vi.spyOn(Message, "find").mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue(mockMessages),
          }),
        }),
      }),
    });

    const req = mockRequest({
      params: { id: receiverId.toString() },
      query: { page: "1", limit: "50" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await getMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const call = res.json.mock.calls[0][0];
    expect(call.messages.length).toBe(50);
    expect(call.hasMore).toBe(false);
  });

  it("sends a message and creates it in database", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");
    const { getReceiverSocketId } = await import("../src/lib/socket.js");

    vi.spyOn(User, "exists").mockResolvedValue(true);
    vi.spyOn(FriendRequest, "exists").mockResolvedValue(true);
    getReceiverSocketId.mockReturnValue(null);

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();

    let savedMessage = null;
    vi.spyOn(Message.prototype, "save").mockImplementation(async function () {
      savedMessage = this;
      return this;
    });

    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: { text: "hello world", image: "" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      text: "hello world",
      status: "sent",
    }));
    expect(savedMessage).toBeTruthy();
    expect(savedMessage.text).toBe("hello world");
  });;

  it("limits page and limit query params", async () => {
    const { getMessages } = await import("../src/controllers/message.controller.js");

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();

    vi.spyOn(Message, "find").mockReturnValue({
      sort: vi.fn().mockReturnValue({
        skip: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            lean: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    });

    const req = mockRequest({
      params: { id: receiverId.toString() },
      query: { page: "1000", limit: "10000" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await getMessages(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const call = res.json.mock.calls[0][0];
    expect(call.limit).toBeLessThanOrEqual(100);
  });

  it("rejects editMessage with empty text", async () => {
    const { editMessage } = await import("../src/controllers/message.controller.js");

    const userId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: messageId.toString() },
      body: { text: "   " },
      user: { _id: userId },
    });
    const res = mockResponse();

    await editMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Message text cannot be empty" });
  });

  it("rejects editMessage from a user who is not the sender", async () => {
    const { editMessage } = await import("../src/controllers/message.controller.js");

    const ownerId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();

    vi.spyOn(Message, "findById").mockResolvedValue({
      _id: messageId,
      senderId: ownerId,
      receiverId: new mongoose.Types.ObjectId(),
      isDeleted: false,
      save: vi.fn(),
    });

    const req = mockRequest({
      params: { id: messageId.toString() },
      body: { text: "hacked" },
      user: { _id: otherUserId },
    });
    const res = mockResponse();

    await editMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: "You can only edit your own messages",
    });
  });

  it("edits own message and marks it edited", async () => {
    const { editMessage } = await import("../src/controllers/message.controller.js");
    const { getReceiverSocketId } = await import("../src/lib/socket.js");
    getReceiverSocketId.mockReturnValue(null);

    const ownerId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const saveMock = vi.fn().mockResolvedValue(true);
    const messageDoc = {
      _id: messageId,
      senderId: ownerId,
      receiverId: new mongoose.Types.ObjectId(),
      text: "old text",
      isDeleted: false,
      isEdited: false,
      editedAt: null,
      save: saveMock,
    };
    vi.spyOn(Message, "findById").mockResolvedValue(messageDoc);

    const req = mockRequest({
      params: { id: messageId.toString() },
      body: { text: "new text" },
      user: { _id: ownerId },
    });
    const res = mockResponse();

    await editMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(messageDoc.text).toBe("new text");
    expect(messageDoc.isEdited).toBe(true);
    expect(saveMock).toHaveBeenCalled();
  });

  it("rejects deleteMessage from a user who is not the sender", async () => {
    const { deleteMessage } = await import("../src/controllers/message.controller.js");

    const ownerId = new mongoose.Types.ObjectId();
    const otherUserId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();

    vi.spyOn(Message, "findById").mockResolvedValue({
      _id: messageId,
      senderId: ownerId,
      receiverId: new mongoose.Types.ObjectId(),
      isDeleted: false,
      save: vi.fn(),
    });

    const req = mockRequest({
      params: { id: messageId.toString() },
      user: { _id: otherUserId },
    });
    const res = mockResponse();

    await deleteMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      message: "You can only delete your own messages",
    });
  });

  it("soft-deletes own message and clears its content", async () => {
    const { deleteMessage } = await import("../src/controllers/message.controller.js");
    const { getReceiverSocketId } = await import("../src/lib/socket.js");
    getReceiverSocketId.mockReturnValue(null);

    const ownerId = new mongoose.Types.ObjectId();
    const messageId = new mongoose.Types.ObjectId();
    const saveMock = vi.fn().mockResolvedValue(true);
    const messageDoc = {
      _id: messageId,
      senderId: ownerId,
      receiverId: new mongoose.Types.ObjectId(),
      text: "secret",
      image: "http://example.com/img.png",
      isDeleted: false,
      deletedAt: null,
      save: saveMock,
    };
    vi.spyOn(Message, "findById").mockResolvedValue(messageDoc);

    const req = mockRequest({
      params: { id: messageId.toString() },
      user: { _id: ownerId },
    });
    const res = mockResponse();

    await deleteMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(messageDoc.isDeleted).toBe(true);
    expect(messageDoc.text).toBe("");
    expect(messageDoc.image).toBe(null);
    expect(saveMock).toHaveBeenCalled();
  });

  it("rejects sending a message to a non-friend", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    vi.spyOn(User, "exists").mockResolvedValue(true);
    // No accepted friendship between the two users.
    vi.spyOn(FriendRequest, "exists").mockResolvedValue(false);

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: { text: "hi stranger", image: "" },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "You can only message your friends" });
  });

  it("rejects a file attachment with a disallowed type", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: {
        text: "",
        // An executable disguised as an attachment — must be rejected.
        file: { data: "data:application/x-msdownload;base64,QUJD", name: "evil.exe" },
      },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "File type is not allowed" });
  });

  it("rejects a file attachment larger than the size limit", async () => {
    const { sendMessage } = await import("../src/controllers/message.controller.js");

    const senderId = new mongoose.Types.ObjectId();
    const receiverId = new mongoose.Types.ObjectId();
    // ~7MB of base64 body -> ~5.25MB decoded, over the 5MB cap.
    const bigBase64 = "A".repeat(7 * 1024 * 1024);
    const req = mockRequest({
      params: { id: receiverId.toString() },
      body: {
        text: "",
        file: { data: `data:application/pdf;base64,${bigBase64}`, name: "big.pdf" },
      },
      user: { _id: senderId },
    });
    const res = mockResponse();

    await sendMessage(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "File is too large (max 5MB)" });
  });
});
