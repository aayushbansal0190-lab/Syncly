/**
 * In-memory cache for messages
 * Stores recently accessed messages to reduce database queries
 * Automatically expires after TTL
 */
class MessageCache {
  constructor() {
    this.cache = new Map();
    this.TTL = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Get cached messages for a chat
   * @param {string} userId1 - First user ID
   * @param {string} userId2 - Second user ID
   * @param {number} page - Page number (50 messages per page)
   * @returns {Array|null} Cached messages or null if expired/not found
   */
  get(userId1, userId2, page, limit) {
    // Create consistent key regardless of user order
    const key = this._generateKey(userId1, userId2, page, limit);
    const item = this.cache.get(key);

    if (!item) return null;

    // Check if expired
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return item.data;
  }

  /**
   * Set messages in cache
   * @param {string} userId1 - First user ID
   * @param {string} userId2 - Second user ID
   * @param {number} page - Page number
   * @param {Array} messages - Messages to cache
   */
  set(userId1, userId2, page, limit, messages) {
    const key = this._generateKey(userId1, userId2, page, limit);
    this.cache.set(key, {
      data: messages,
      expiresAt: Date.now() + this.TTL,
    });
  }

  /**
   * Invalidate all cache for a specific chat
   * Called when new message sent in that chat
   * @param {string} userId1 - First user ID
   * @param {string} userId2 - Second user ID
   */
  invalidateChat(userId1, userId2) {
    const ids = [userId1.toString(), userId2.toString()].sort();
    const prefix = `${ids[0]}_${ids[1]}`;
    
    // Remove all pages for this chat
    for (let [key] of this.cache) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Invalidate entire cache (user logout, etc)
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Generate consistent cache key
   * @private
   */
  _generateKey(userId1, userId2, page, limit) {
    // Sort user IDs lexicographically (Math.min/max on ObjectIds produce NaN!)
    const ids = [userId1.toString(), userId2.toString()].sort();
    return `${ids[0]}_${ids[1]}_page_${page}_limit_${limit}`;
  }

  /**
   * Get cache stats (for debugging)
   */
  getStats() {
    return {
      size: this.cache.size,
      ttl: this.TTL,
    };
  }
}

// Singleton instance
export const messageCache = new MessageCache();
