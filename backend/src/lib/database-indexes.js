import Message from "../models/message.model.js";
import User from "../models/user.model.js";

/**
 * Initialize database indexes for optimal query performance
 * Indexes speed up message queries by 50-100x
 * Called once on server startup
 */
export const initializeIndexes = async () => {
  try {
    // Message Indexes
    // Most important: findMessages between two users (senderId + receiverId)
    await Message.collection.createIndex({ senderId: 1, receiverId: 1, createdAt: -1 });
    
    // For finding new messages for a specific receiver
    await Message.collection.createIndex({ receiverId: 1, createdAt: -1 });
    
    // For finding unseen messages
    await Message.collection.createIndex({ status: 1, receiverId: 1 });
    
    // User Indexes
    // For login (email lookup)
    await User.collection.createIndex({ email: 1 }, { unique: true });
    
    console.log("✅ Database indexes created successfully");
  } catch (error) {
    // Index might already exist - that's fine
    if (error.code === 85) {
      console.log("✅ Database indexes already exist");
    } else {
      console.error("Error creating indexes:", error.message);
    }
  }
};
