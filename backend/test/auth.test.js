import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import User from "../src/models/user.model.js";
import bcrypt from "bcryptjs";

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

describe("auth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects signup when password is too short", async () => {
    const { signup } = await import("../src/controllers/auth.controller.js");

    const req = mockRequest({
      body: {
        fullName: "Test User",
        email: "test@example.com",
        password: "12345",
      },
    });
    const res = mockResponse();

    await signup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Password must be at least 6 characters",
    });
  });

  it("validates all required fields are provided", async () => {
    const { signup } = await import("../src/controllers/auth.controller.js");

    const req = mockRequest({
      body: {
        fullName: "",
        email: "",
        password: "",
      },
    });
    const res = mockResponse();

    await signup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "All fields are required" });
  });

  it("rejects signup for duplicate email", async () => {
    const { signup } = await import("../src/controllers/auth.controller.js");

    vi.spyOn(User, "findOne").mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      email: "test@example.com",
    });

    const req = mockRequest({
      body: {
        fullName: "Test User",
        email: "test@example.com",
        password: "password123",
      },
    });
    const res = mockResponse();

    await signup(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Email already exists" });
  });

  it("rejects login with non-existent email", async () => {
    const { login } = await import("../src/controllers/auth.controller.js");

    vi.spyOn(User, "findOne").mockResolvedValue(null);

    const req = mockRequest({
      body: {
        email: "nonexistent@example.com",
        password: "password123",
      },
    });
    const res = mockResponse();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid credentials" });
  });

  it("rejects login with wrong password", async () => {
    const { login } = await import("../src/controllers/auth.controller.js");

    vi.spyOn(User, "findOne").mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      email: "test@example.com",
      password: "hashed-correct-password",
    });

    vi.spyOn(bcrypt, "compare").mockResolvedValue(false);

    const req = mockRequest({
      body: {
        email: "test@example.com",
        password: "wrong-password",
      },
    });
    const res = mockResponse();

    await login(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid credentials" });
  });

  it("returns user on successful logout", async () => {
    const { logout } = await import("../src/controllers/auth.controller.js");

    const req = mockRequest();
    const res = mockResponse();

    logout(req, res);

    expect(res.clearCookie).toHaveBeenCalledWith("jwt", expect.any(Object));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: "Logged out successfully" });
  });

  it("returns authenticated user in checkAuth", async () => {
    const { checkAuth } = await import("../src/controllers/auth.controller.js");

    const userId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      user: {
        _id: userId,
        email: "test@example.com",
        fullName: "Test User",
      },
    });
    const res = mockResponse();

    checkAuth(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(req.user);
  });

  it("rejects updateProfile without image data", async () => {
    const { updateProfile } = await import("../src/controllers/auth.controller.js");

    const userId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      body: { profilePic: "" },
      user: { _id: userId },
    });
    const res = mockResponse();

    await updateProfile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Profile pic is required" });
  });

  it("rejects updateProfile with invalid image format", async () => {
    const { updateProfile } = await import("../src/controllers/auth.controller.js");

    const userId = new mongoose.Types.ObjectId();
    const req = mockRequest({
      body: { profilePic: "not-a-data-url" },
      user: { _id: userId },
    });
    const res = mockResponse();

    await updateProfile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: "Profile pic must be a valid image data URL",
    });
  });
});
