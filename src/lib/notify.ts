// Desktop / mobile notifications for long-running jobs (research, audits).
// Falls back silently when the browser blocks or lacks Notification support.

export const notificationsSupported = () =>
  typeof window !== "undefined" && "Notification" in window;

export const notificationsEnabled = () =>
  notificationsSupported() && Notification.permission === "granted";

export async function askNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  try {
    const res = await Notification.requestPermission();
    return res === "granted";
  } catch {
    return false;
  }
}

export function notifyJobDone(title: string, body: string, tag?: string) {
  if (!notificationsEnabled()) return;
  // Only notify when the user isn't already looking at the page.
  if (typeof document !== "undefined" && document.visibilityState === "visible") return;
  try {
    const n = new Notification(title, { body, tag, icon: "/placeholder.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* ignore */
  }
}
