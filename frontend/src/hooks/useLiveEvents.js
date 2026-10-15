import { useEffect, useRef } from "react";
import api from "../api/client.js";
import { parseServerEvent } from "../utils/serverEvents.js";

export const RECORD_CHANGED_EVENT = "uma:record-changed";
const COMMENT_TYPES = new Set(["COMMENT_MENTION", "REQUEST_COMMENT"]);

// Live updates (GET /api/events): a new notification refreshes the bell at once, tells the page
// showing that record to reload (RECORD_CHANGED_EVENT), and calls onNotification (a toast).
// Read with fetch so the Authorization header applies; reconnects with a growing pause.
export default function useLiveEvents({ enabled, onNotification }) {
  const handler = useRef(onNotification);
  handler.current = onNotification;

  useEffect(() => {
    if (!enabled || typeof window.fetch !== "function" || typeof TextDecoder === "undefined") return undefined;
    let stopped = false;
    let controller;
    let retry;
    let pause = 5000;

    async function connect() {
      const token = localStorage.getItem("erp_token");
      if (!token || stopped) return;
      controller = new AbortController();
      try {
        const response = await fetch(`${api.defaults.baseURL}/events`, { headers: { Authorization: `Bearer ${token}`, Accept: "text/event-stream" }, signal: controller.signal, cache: "no-store" });
        if (!response.ok || !response.body) throw new Error(`Live updates unavailable (${response.status})`);
        pause = 5000;
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!stopped) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\r?\n\r?\n/);
          buffer = blocks.pop() || "";
          for (const block of blocks) {
            const message = parseServerEvent(block);
            if (message?.event !== "notification") continue;
            const item = message.data.notification;
            window.dispatchEvent(new CustomEvent("erp:tasks-changed"));
            if (item?.entityId) window.dispatchEvent(new CustomEvent(RECORD_CHANGED_EVENT, { detail: { entityType: item.entityType, entityId: String(item.entityId), type: item.type } }));
            if (item?.entityId && COMMENT_TYPES.has(item.type)) window.dispatchEvent(new CustomEvent("uma:comments-changed", { detail: { requestId: String(item.entityId) } }));
            handler.current?.(item);
          }
        }
      } catch {
        // Offline, signed out or the server restarted: try again after a pause.
      }
      if (!stopped) {
        retry = window.setTimeout(connect, pause);
        pause = Math.min(pause * 2, 60000);
      }
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      controller?.abort();
    };
  }, [enabled]);
}
