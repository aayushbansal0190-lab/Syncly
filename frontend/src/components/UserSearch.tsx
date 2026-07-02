import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Search, Loader2, UserPlus, Check, UserCheck } from "lucide-react";
import { axiosInstance } from "../lib/axios";
import { getErrorMessage } from "../lib/error";
import toast from "react-hot-toast";
import type { User } from "../types";

// Relationship of the logged-in user to a search result, computed server-side.
type FriendStatus = "none" | "sent" | "received" | "friends";
type SearchUser = User & { status: FriendStatus };

const UserSearch = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isSending, setIsSending] = useState<string | null>(null);

  // Debounced search: wait 300ms after the last keystroke before hitting the
  // API, so typing a username fires ONE request instead of one per character.
  // The `ignore` flag drops any in-flight response whose query is already stale.
  useEffect(() => {
    const query = searchQuery.trim();
    if (!query) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    let ignore = false;
    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const res = await axiosInstance.get(
          `/friends/search?query=${encodeURIComponent(query)}&limit=10`
        );
        if (!ignore) setSearchResults(res.data);
      } catch (error) {
        console.error("Search error:", error);
        if (!ignore) toast.error("Failed to search users");
      } finally {
        if (!ignore) setIsSearching(false);
      }
    }, 300);

    return () => {
      ignore = true;
      clearTimeout(timer);
    };
  }, [searchQuery]);

  const handleSendRequest = async (user: SearchUser) => {
    setIsSending(user.username);
    try {
      await axiosInstance.post("/friends/request/send", {
        receiverUsername: user.username,
      });
      toast.success("Friend request sent!");
      // Flip THIS row to "sent" in place, instead of clearing the whole search —
      // so the user sees immediate, accurate feedback and can't re-send.
      setSearchResults((prev) =>
        prev.map((u) => (u._id === user._id ? { ...u, status: "sent" } : u))
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to send request"));
    } finally {
      setIsSending(null);
    }
  };

  // Renders the correct action for a result based on the relationship status.
  const renderAction = (user: SearchUser) => {
    switch (user.status) {
      case "friends":
        return (
          <span className="btn btn-xs btn-ghost btn-disabled gap-1">
            <UserCheck className="size-3" />
            Friends
          </span>
        );
      case "sent":
        return (
          <span className="btn btn-xs btn-ghost btn-disabled gap-1">
            <Check className="size-3" />
            Sent
          </span>
        );
      case "received":
        // They already asked us — send them to the page where they can accept.
        return (
          <Link to="/requests" className="btn btn-xs btn-secondary gap-1">
            Respond
          </Link>
        );
      default:
        return (
          <button
            onClick={() => handleSendRequest(user)}
            disabled={isSending === user.username}
            className="btn btn-xs btn-primary gap-1"
          >
            {isSending === user.username ? (
              <Loader2 className="size-3 animate-spin" />
            ) : (
              <>
                <UserPlus className="size-3" />
                Add
              </>
            )}
          </button>
        );
    }
  };

  return (
    <div className="border-b border-base-300 p-4 space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-base-content/40" />
        <input
          type="text"
          placeholder="Search by username..."
          className="input input-sm input-bordered w-full pl-10"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {isSearching && (
        <div className="flex justify-center py-2">
          <Loader2 className="size-5 animate-spin text-primary" />
        </div>
      )}

      {searchResults.length > 0 && (
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {searchResults.map((user) => (
            <div
              key={user._id}
              className="flex items-center justify-between p-2 rounded-lg hover:bg-base-200 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <img
                  src={user.profilePic || "/avatar.png"}
                  alt={user.fullName}
                  className="size-8 rounded-full object-cover flex-shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{user.fullName}</p>
                  <p className="text-xs text-base-content/60 truncate">@{user.username}</p>
                </div>
              </div>
              {renderAction(user)}
            </div>
          ))}
        </div>
      )}

      {searchQuery && !isSearching && searchResults.length === 0 && (
        <p className="text-center text-sm text-base-content/60">No users found</p>
      )}
    </div>
  );
};

export default UserSearch;
