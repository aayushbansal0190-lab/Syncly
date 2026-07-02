import { useChatStore } from "../store/useChatStore";
import { useEffect, useRef, useState } from "react";

import Sidebar from "../components/Sidebar";
import NoChatSelected from "../components/NoChatSelected";
import ChatContainer from "../components/ChatContainer";

// Bounds for the resizable chat list: a slim icons-only rail up to a
// comfortable wide list. Kept out of render so they're easy to tweak.
const MIN_SIDEBAR = 80;
const MAX_SIDEBAR = 448;
const DEFAULT_SIDEBAR = 288; // matches the old fixed lg:w-72

const HomePage = () => {
  const { selectedUser } = useChatStore();

  // The flex row containing the sidebar + chat. We measure its left edge so the
  // drag maps the mouse X to a sidebar width regardless of page scroll/layout.
  const rowRef = useRef<HTMLDivElement>(null);
  const isResizing = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = Number(localStorage.getItem("sidebar-width"));
    return saved >= MIN_SIDEBAR && saved <= MAX_SIDEBAR ? saved : DEFAULT_SIDEBAR;
  });

  // Persist the chosen width so it survives reloads.
  useEffect(() => {
    localStorage.setItem("sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  // Desktop vs mobile. On phones we show ONE pane at a time (friends list OR the
  // open chat, full-screen), so the fixed-px resizable split only applies on
  // large screens. Without this, the px-wide sidebar covers a phone screen.
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  );
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const onChange = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Drag lifecycle: mousedown on the handle arms `isResizing`; listeners on the
  // window (not the handle) keep the drag working even when the cursor moves
  // faster than the thin handle can follow.
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current || !rowRef.current) return;
      const left = rowRef.current.getBoundingClientRect().left;
      const next = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX - left));
      setSidebarWidth(next);
    };
    const stop = () => {
      if (!isResizing.current) return;
      isResizing.current = false;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", stop);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", stop);
    };
  }, []);

  const startResize = () => {
    isResizing.current = true;
    // Suppress text selection + show the resize cursor for the whole drag.
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
  };

  return (
    <div className="h-screen bg-base-200">
      <div className="flex items-center justify-center pt-20 px-4">
        <div className="bg-base-100 rounded-lg shadow-cl w-full max-w-6xl h-[calc(100vh-8rem)]">
          <div ref={rowRef} className="flex h-full rounded-lg overflow-hidden">
            {/* Sidebar pane: full-screen friends list on mobile (hidden once a
                chat is open); fixed, resizable width on desktop. */}
            <div
              className={`${selectedUser ? "hidden md:block" : "block"} w-full md:w-auto shrink-0 h-full`}
              style={isDesktop ? { width: sidebarWidth } : undefined}
            >
              <Sidebar width={isDesktop ? sidebarWidth : DEFAULT_SIDEBAR} />
            </div>

            {/* Draggable divider — desktop only (no cursor drag on touch). */}
            {isDesktop && (
              <div
                onMouseDown={startResize}
                onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR)}
                title="Drag to resize · double-click to reset"
                className="w-1 shrink-0 cursor-col-resize bg-base-300 hover:bg-primary/50 transition-colors"
              />
            )}

            {/* Chat pane: hidden on mobile until a chat is selected, then full-screen. */}
            <div
              className={`${selectedUser ? "flex" : "hidden md:flex"} flex-1 min-w-0 h-full`}
            >
              {!selectedUser ? <NoChatSelected /> : <ChatContainer />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
export default HomePage;
