import { useEffect } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check, X, UserPlus } from "lucide-react";
import { useFriendStore } from "../store/useFriendStore";

// Dedicated page for incoming friend requests. Reachable from the navbar; keeps
// the chat sidebar focused purely on conversations.
const RequestsPage = () => {
  const { pendingRequests, isLoadingRequests, getPendingRequests, acceptRequest, rejectRequest } =
    useFriendStore();

  useEffect(() => {
    getPendingRequests();
  }, [getPendingRequests]);

  return (
    <div className="min-h-screen bg-base-200 pt-20 px-4">
      <div className="max-w-2xl mx-auto">
        <Link to="/" className="btn btn-ghost btn-sm gap-2 mb-4">
          <ArrowLeft className="size-4" />
          Back to chat
        </Link>

        <div className="bg-base-100 rounded-xl shadow-sm border border-base-300 p-6">
          <div className="flex items-center gap-2 mb-6">
            <UserPlus className="size-5 text-primary" />
            <h1 className="text-xl font-semibold">Friend Requests</h1>
            {pendingRequests.length > 0 && (
              <span className="badge badge-primary badge-sm">{pendingRequests.length}</span>
            )}
          </div>

          {isLoadingRequests ? (
            <div className="flex justify-center py-12">
              <span className="loading loading-spinner" />
            </div>
          ) : pendingRequests.length === 0 ? (
            <div className="text-center py-12 text-base-content/60">
              <UserPlus className="size-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No pending requests</p>
              <p className="text-sm">When someone adds you, it&apos;ll show up here.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {pendingRequests.map((req) => (
                <li
                  key={req._id}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg hover:bg-base-200 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={req.sender?.profilePic || "/avatar.png"}
                      alt={req.sender?.fullName}
                      className="size-12 rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <p className="font-medium truncate">{req.sender?.fullName}</p>
                      <p className="text-sm text-base-content/60 truncate">@{req.sender?.username}</p>
                    </div>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <button
                      onClick={() => acceptRequest(req._id)}
                      className="btn btn-sm btn-success text-white gap-1"
                    >
                      <Check className="size-4" />
                      Accept
                    </button>
                    <button
                      onClick={() => rejectRequest(req._id)}
                      className="btn btn-sm btn-ghost gap-1"
                    >
                      <X className="size-4" />
                      Reject
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
};
export default RequestsPage;
