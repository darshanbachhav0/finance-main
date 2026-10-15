import { EventEmitter } from "events";

// Live updates for signed-in browsers: every new or re-sent notification is pushed at once to that
// person's open tabs (GET /api/events, server-sent events), so the bell, the request page and the
// comments update without a refresh. In-process: with several server instances a tab only hears
// its own instance, and the 30-second refresh the bell already does covers the rest.
const bus = new EventEmitter();
bus.setMaxListeners(0);

const channel = (userId) => `user:${String(userId)}`;

export function publishToUser(userId, event) {
  if (!userId) return;
  bus.emit(channel(userId), event);
}

export function subscribeUser(userId, listener) {
  bus.on(channel(userId), listener);
  return () => bus.off(channel(userId), listener);
}

export function liveListenerCount(userId) {
  return bus.listenerCount(channel(userId));
}

// What a browser needs to show a notification and refresh the record it is about.
export function notificationEvent(notification) {
  const value = notification?.toObject ? notification.toObject() : notification;
  if (!value) return null;
  return {
    type: "notification",
    notification: {
      _id: value._id,
      type: value.type,
      title: value.title,
      message: value.message,
      titleKey: value.titleKey,
      messageKey: value.messageKey,
      params: value.params,
      path: value.path,
      entityType: value.entityType,
      entityId: value.entityId,
      createdAt: value.createdAt
    }
  };
}

const HEARTBEAT_MS = 25000;

// Express handler: keeps the response open and writes each event as it happens. A heartbeat
// comment keeps proxies from closing an idle stream.
export function streamUserEvents(req, res) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();
  res.write("retry: 15000\n\n");
  res.write(`event: ready\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
  const unsubscribe = subscribeUser(req.user._id, (event) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  });
  const heartbeat = setInterval(() => res.write(": ping\n\n"), HEARTBEAT_MS);
  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
}
