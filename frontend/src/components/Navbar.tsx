import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useAuthStore } from "../store/useAuthStore";
import { useFriendStore } from "../store/useFriendStore";
import { LogOut, MessageSquare, Settings, User, UserPlus } from "lucide-react";

const Navbar = () => {
  const { logout, authUser } = useAuthStore();
  const { pendingRequests, getPendingRequests } = useFriendStore();

  // Load pending requests once logged in so the navbar badge is accurate on any
  // page. The friend store's real-time handlers keep this count fresh after.
  useEffect(() => {
    if (authUser) getPendingRequests();
  }, [authUser, getPendingRequests]);

  return (
    <header
      className="bg-base-100 border-b border-base-300 fixed w-full top-0 z-40 
    backdrop-blur-lg bg-base-100/80"
    >
      <div className="container mx-auto px-4 h-16">
        <div className="flex items-center justify-between h-full">
          <div className="flex items-center gap-8">
            <Link to="/" className="flex items-center gap-2.5 hover:opacity-80 transition-all">
              <div className="size-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <h1 className="text-lg font-bold">Chatty</h1>
            </Link>
          </div>

          <div className="flex items-center gap-2">
            <Link to="/settings" className="btn btn-sm btn-ghost gap-2">
              <Settings className="w-4 h-4" />
              <span className="hidden sm:inline">Settings</span>
            </Link>

            {authUser && (
              <>
                <Link to="/requests" className="btn btn-sm btn-ghost gap-2 relative">
                  <UserPlus className="size-4" />
                  <span className="hidden sm:inline">Requests</span>
                  {pendingRequests.length > 0 && (
                    <span className="badge badge-primary badge-xs absolute -top-1 -right-1">
                      {pendingRequests.length}
                    </span>
                  )}
                </Link>

                <Link to="/profile" className="btn btn-sm btn-ghost gap-2">
                  <User className="size-4" />
                  <span className="hidden sm:inline">Profile</span>
                </Link>

                {/* Same btn-ghost styling as the others so the bar reads as one
                    consistent set of controls rather than a stray text button. */}
                <button className="btn btn-sm btn-ghost gap-2" onClick={logout}>
                  <LogOut className="size-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </header>
  );
};
export default Navbar;
