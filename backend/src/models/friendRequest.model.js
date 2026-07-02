import mongoose from "mongoose";

const friendRequestSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true }
);

// Prevent duplicate requests: unique constraint on sender + receiver + status
friendRequestSchema.index({ sender: 1, receiver: 1, status: 1 }, { unique: true });

// Index for finding pending requests for a user
friendRequestSchema.index({ receiver: 1, status: 1 });
friendRequestSchema.index({ sender: 1, status: 1 });

const FriendRequest = mongoose.model("FriendRequest", friendRequestSchema);

export default FriendRequest;
