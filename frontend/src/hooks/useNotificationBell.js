import { useCallback, useEffect, useRef, useState } from "react";
import api from "../api/client.js";

const emptyTasks = { items: [], total: 0, counters: {} };
const emptyNotifications = { data: [], unreadCount: 0 };

export default function useNotificationBell(userId) {
  const [tasks, setTasks] = useState(emptyTasks);
  const [notifications, setNotifications] = useState(emptyNotifications);
  const [error, setError] = useState("");
  const version = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++version.current;
    const results = await Promise.allSettled([
      api.get("/dashboard/tasks", { timeout: 10000 }),
      api.get("/notifications", { params: { limit: 100 }, timeout: 10000 })
    ]);
    if (current !== version.current) return;
    // A failed task summary must not hide notifications (or vice versa).
    if (results[0].status === "fulfilled") setTasks({ ...emptyTasks, ...results[0].value.data });
    if (results[1].status === "fulfilled") setNotifications({ ...emptyNotifications, ...results[1].value.data });
    setError(results.some((result) => result.status === "rejected") ? "Some alerts could not be refreshed. Try again." : "");
  }, [userId]);

  useEffect(() => {
    setTasks(emptyTasks);
    setNotifications(emptyNotifications);
    refresh();
    const visibleRefresh = () => { if (document.visibilityState !== "hidden") refresh(); };
    const timer = window.setInterval(visibleRefresh, 30000);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("erp:tasks-changed", refresh);
    document.addEventListener("visibilitychange", visibleRefresh);
    return () => {
      ++version.current;
      window.clearInterval(timer);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("erp:tasks-changed", refresh);
      document.removeEventListener("visibilitychange", visibleRefresh);
    };
  }, [refresh]);

  async function markRead(item) {
    if (item.readAt) return;
    try {
      await api.patch(`/notifications/${item._id}/read`);
      await refresh();
    } catch { setError("Could not mark notifications as read. Try again."); }
  }
  async function markAllRead() {
    try {
      await api.patch("/notifications/read-all");
      await refresh();
    } catch { setError("Could not mark notifications as read. Try again."); }
  }
  return { tasks, notifications, error, refresh, markRead, markAllRead };
}
