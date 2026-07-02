import { useEffect, useState } from "react";
import { useChatStore } from "../store/useChatStore";
import { useAuthStore } from "../store/useAuthStore";
import SidebarSkeleton from "./skeletons/SidebarSkeleton";
import UserSearch from "./UserSearch";
import { Users } from "lucide-react";

interface SidebarProps {
  /** Current width in px, controlled by the draggable divider in HomePage. */
  width: number;
}

const Sidebar = ({ width }: SidebarProps) => {
  const { getUsers, users, selectedUser, setSelectedUser, isUsersLoading, prefetchMessages } =
    useChatStore();

  const { onlineUsers } = useAuthStore();
  const [showOnlineOnly, setShowOnlineOnly] = useState(false);

  // Show names/labels based on the ACTUAL width the user dragged to, not the
  // viewport breakpoint. Below this threshold we collapse to icons-only.
  const collapsed = width < 180;

  useEffect(() => {
    getUsers();
  }, [getUsers]);

  const filteredUsers = showOnlineOnly
    ? users.filter((user) => onlineUsers.includes(user._id))
    : users;

  if (isUsersLoading) return <SidebarSkeleton />;

  return (
    <aside style={{ width }} className="h-full shrink-0 flex flex-col">
      <div className="border-b border-base-300 w-full p-5">
        <div className="flex items-center gap-2">
          <Users className="size-5 shrink-0" />
          {!collapsed && <span className="font-medium">Friends</span>}
        </div>
        {!collapsed && (
          <div className="mt-3 flex items-center gap-2">
            <label className="cursor-pointer flex items-center gap-2">
              <input
                type="checkbox"
                checked={showOnlineOnly}
                onChange={(e) => setShowOnlineOnly(e.target.checked)}
                className="checkbox checkbox-sm"
              />
              <span className="text-sm">Show online only</span>
            </label>
            {/* Exclude yourself from the count, but never go below 0 (the list is
              briefly empty before your own socket connects). */}
          <span className="text-xs text-base-content/60">
            ({Math.max(0, onlineUsers.length - 1)} online)
          </span>
          </div>
        )}
      </div>

      {/* Search only makes sense when expanded. Friend requests now live on a
          dedicated /requests page reached from the navbar. */}
      {!collapsed && <UserSearch />}

      <div className="overflow-y-auto w-full py-3">
        {filteredUsers.length > 0 ? (
          filteredUsers.map((user) => (
            <button
              key={user._id}
              onClick={() => setSelectedUser(user)}
              onMouseEnter={() => prefetchMessages(user._id)}
              className={`
                w-full p-3 flex items-center gap-3
                hover:bg-base-200 transition-colors
                ${selectedUser?._id === user._id ? "bg-base-300 ring-1 ring-inset ring-primary/20" : ""}
              `}
            >
              <div className={`relative ${collapsed ? "mx-auto" : "mx-0"}`}>
                <img
                  src={user.profilePic || "/avatar.png"}
                  alt={user.fullName}
                  className="size-12 object-cover rounded-full"
                />
                {onlineUsers.includes(user._id) && (
                  <span
                    className="absolute bottom-0 right-0 size-3 bg-green-500
                    rounded-full ring-2 ring-base-100"
                  />
                )}
              </div>

              {!collapsed && (
                <div className="text-left min-w-0">
                  <div className="font-medium truncate">{user.fullName}</div>
                  <div className="text-sm text-base-content/60">
                    {onlineUsers.includes(user._id) ? "Online" : "Offline"}
                  </div>
                </div>
              )}
            </button>
          ))
        ) : (
          !collapsed && (
            <div className="text-center text-base-content/60 py-8 px-4">
              <Users className="size-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm font-medium mb-2">No friends yet</p>
              <p className="text-xs">Search above to add friends and start chatting!</p>
            </div>
          )
        )}
      </div>
    </aside>
  );
};
export default Sidebar;
