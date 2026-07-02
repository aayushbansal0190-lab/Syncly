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
            <Sidebar width={sidebarWidth} />

            {/* Draggable divider. Doubles as the visual border between the two
                panes; widens + tints on hover so it's discoverable. */}
            <div
              onMouseDown={startResize}
              onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR)}
              title="Drag to resize · double-click to reset"
              className="w-1 shrink-0 cursor-col-resize bg-base-300 hover:bg-primary/50 transition-colors"
            />

            {!selectedUser ? <NoChatSelected /> : <ChatContainer />}
          </div>
        </div>
      </div>
    </div>
  );
};
export default HomePage;
