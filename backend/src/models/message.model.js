import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    text: {
      type: String,
    },
    image: {
      type: String,
    },
    // Non-image file attachment (PDF, doc, zip, etc.). url points to Cloudinary;
    // name/type/size are kept so the UI can show a labelled, downloadable chip.
    file: {
      url: { type: String },
      name: { type: String },
      type: { type: String },
      size: { type: Number },
    },
    status: {
      type: String,
      enum: ["sent", "received", "seen"],
      default: "sent",
    },
    // Edit/delete support. We use a "soft delete": the document stays in the DB
    // but its content is cleared and isDeleted flips to true, so the chat history
    // has no gaps and we keep an audit trail (deletedAt).
    isEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
      default: null,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

const Message = mongoose.model("Message", messageSchema);

export default Message;
