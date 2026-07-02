import { X, Video, Search } from "lucide-react";
import { useAuthStore } from "../store/useAuthStore";
import { useChatStore } from "../store/useChatStore";
import { useCallStore } from "../store/useCallStore";
import AiAssistant from "./AiAssistant";

interface ChatHeaderProps {
  searchOpen: boolean;
  onToggleSearch: () => void;
}

const ChatHeader = ({ searchOpen, onToggleSearch }: ChatHeaderProps) => {
  const { selectedUser, setSelectedUser } = useChatStore();
  const { onlineUsers } = useAuthStore();
  const { startCall, callStatus } = useCallStore();

  // ChatHeader is only rendered inside an open chat, but this guard makes that
  // guarantee explicit to TypeScript (and avoids null access below).
  if (!selectedUser) return null;

  return (
    <div className="p-2.5 border-b border-base-300">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="avatar">
            <div className="size-10 rounded-full relative">
              <img src={selectedUser.profilePic || "/avatar.png"} alt={selectedUser.fullName} />
            </div>
          </div>
          <div>
            <h3 className="font-medium">{selectedUser.fullName}</h3>
            <p className="text-sm text-base-content/70">
              {onlineUsers.includes(selectedUser._id) ? "Online" : "Offline"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* AI assistant: summarize the chat or draft a reply. */}
          <AiAssistant />
          {/* Start a video call. Disabled while a call is already in progress. */}
          <button
            onClick={() => startCall(selectedUser)}
            disabled={callStatus !== "idle"}
            title="Start video call"
            className="btn btn-ghost btn-sm btn-circle"
          >
            <Video className="size-5" />
          </button>
          {/* Toggle in-conversation search (highlighted while active). */}
          <button
            onClick={onToggleSearch}
            title="Search messages"
            className={`btn btn-ghost btn-sm btn-circle ${searchOpen ? "text-primary" : ""}`}
          >
            <Search className="size-5" />
          </button>
          <button
            onClick={() => setSelectedUser(null)}
            title="Close chat"
            className="btn btn-ghost btn-sm btn-circle"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
    </div>
  );
};
export default ChatHeader;
