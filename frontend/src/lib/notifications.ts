// Thin wrapper around the browser Notification API.
//
// This shows desktop notifications while the app tab is OPEN but not focused
// (e.g. the user switched to another tab or window). Showing notifications when
// the app is fully CLOSED is a separate, heavier feature called Web Push, which
// needs a service worker + VAPID keys + stored push subscriptions on the server.
// We deliberately keep this lightweight: no dependencies, no backend changes.

export const isNotificationSupported = () =>
  typeof window !== "undefined" && "Notification" in window;

/**
 * Ask the browser for permission to show notifications. Safe to call multiple
 * times — if the user already granted or denied, we just return that state.
 * @returns {Promise<string>} "granted" | "denied" | "default" | "unsupported"
 */
export const requestNotificationPermission = async () => {
  if (!isNotificationSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return "default";
  }
};

/**
 * Show a desktop notification for an incoming message.
 * We skip it when the user is actively looking at the app (visible AND focused),
 * so we only interrupt when they're actually away.
 */
export const showMessageNotification = ({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon?: string | null;
}): void => {
  if (!isNotificationSupported() || Notification.permission !== "granted") return;
  // Don't interrupt someone who is already looking at the app.
  if (document.visibilityState === "visible" && document.hasFocus()) return;

  try {
    const notification = new Notification(title, {
      body,
      icon: icon || "/avatar.png",
      tag: "chat-message", // collapses repeated notifications into one
    });
    // Clicking the notification brings the app back into focus.
    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch {
    // Some environments disallow constructing notifications directly; ignore.
  }
};
