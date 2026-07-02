import Navbar from "./components/Navbar";

import { Routes, Route, Navigate } from "react-router-dom";
import { useAuthStore } from "./store/useAuthStore";
import { useThemeStore } from "./store/useThemeStore";
import { lazy, Suspense, useEffect } from "react";

import { Loader } from "lucide-react";
import { Toaster } from "react-hot-toast";

// Code-split: each page and the WebRTC call UI load on demand, so the initial
// bundle only carries what's needed to show the first screen. VideoCall in
// particular pulls in the peer-connection logic only once the user is logged in.
const VideoCall = lazy(() => import("./components/VideoCall"));
const HomePage = lazy(() => import("./pages/HomePage"));
const SignUpPage = lazy(() => import("./pages/SignUpPage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const RequestsPage = lazy(() => import("./pages/RequestsPage"));

const PageLoader = () => (
  <div className="flex items-center justify-center h-screen">
    <Loader className="size-10 animate-spin" />
  </div>
);

const App = () => {
  const { authUser, checkAuth, isCheckingAuth } = useAuthStore();
  const { theme } = useThemeStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isCheckingAuth && !authUser) return <PageLoader />;

  return (
    <div data-theme={theme}>
      <Navbar />

      <Suspense fallback={<PageLoader />}>
        {/* Always mounted while logged in so incoming calls can pop up anywhere. */}
        {authUser && <VideoCall />}

        <Routes>
          <Route path="/" element={authUser ? <HomePage /> : <Navigate to="/login" />} />
          <Route path="/signup" element={!authUser ? <SignUpPage /> : <Navigate to="/" />} />
          <Route path="/login" element={!authUser ? <LoginPage /> : <Navigate to="/" />} />
          {/* Public: it's only the theme switcher (no auth/chat data), so it
              stays reachable from the login page too. */}
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/profile" element={authUser ? <ProfilePage /> : <Navigate to="/login" />} />
          <Route path="/requests" element={authUser ? <RequestsPage /> : <Navigate to="/login" />} />
        </Routes>
      </Suspense>

      <Toaster />
    </div>
  );
};
export default App;
