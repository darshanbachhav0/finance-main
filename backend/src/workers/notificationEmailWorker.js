import "dotenv/config";
import mongoose from "mongoose";
import { isMainModule } from "./isMainModule.js";
import { connectDB } from "../config/db.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { createEmailTransport } from "../integrations/email/index.js";
import { emailErrorHint, notificationEmailConfiguration, notificationEmailEvents, processNotificationEmails } from "../services/notificationEmailService.js";

// A queued email wakes the worker after this pause, so the notifications one action raises (e.g.
// several approvers, or a request and its budget alert) still go out as one email per person.
const WAKE_AFTER_QUEUE_MS = 1000;

// Sends the queued notification emails (services/notificationEmailService.js) on an already-open
// Mongoose connection until stop() is called. Each pass claims a person's due deliveries with a
// unique token, so a second process never emails the same delivery twice.
export function startNotificationEmailWorker({ once = false, env = process.env } = {}) {
  const config = notificationEmailConfiguration(env);
  let stopping = false;
  let timer;
  let wake;
  let wakeTimer;
  let queuedDuringPass = false;
  const onQueued = () => {
    queuedDuringPass = true;
    if (wakeTimer) return;
    wakeTimer = setTimeout(() => { wakeTimer = undefined; wake?.(); }, WAKE_AFTER_QUEUE_MS);
  };
  const done = (async () => {
    if (!config.enabled) {
      console.log(config.mode === "OFF" ? "Notification email worker: NOTIFICATION_EMAIL_MODE=OFF, nothing to send." : `Notification email worker not started: ${config.problems.join(" ")}`);
      return;
    }
    for (const warning of config.warnings) console.warn(`Notification email: ${warning}`);
    if (config.allowedDomains.length) console.log(`Notification email: only addresses @${config.allowedDomains.join(", @")} are emailed (NOTIFICATION_EMAIL_ALLOWED_DOMAINS); others are skipped.`);
    const transport = createEmailTransport(config);
    console.log(`Notification email worker: ${transport.name}; ${config.delayMs ? `emails wait ${config.delayMs / 60000} min (NOTIFICATION_EMAIL_DELAY_MINUTES) so alerts read in the app are not emailed` : "emails are sent as soon as the notification is created"}; retries checked every ${config.pollMs}ms`);
    // Visible in the host's logs (Render: Logs tab): whether the SMTP server accepts the sign-in.
    transport.verify()
      .then(() => console.log(`Notification email: ${transport.name} sign-in OK, sending as ${config.from || "(default sender)"}`))
      .catch((error) => console.error(`Notification email: ${transport.name} sign-in FAILED - ${error?.message || error}${emailErrorHint(error, config) ? `
${emailErrorHint(error, config)}` : ""}`));
    await NotificationDelivery.createIndexes();
    notificationEmailEvents.on("queued", onQueued);
    try {
      do {
        queuedDuringPass = false;
        try {
          const summary = await processNotificationEmails({ env, transport });
          if (summary.users) console.log("Notification email pass", summary);
        } catch (error) { console.error("Notification email pass failed", error); if (once) throw error; }
        if (once || stopping) break;
        // An email queued while this pass ran goes out after the short grouping pause; otherwise sleep
        // until the next queued email (or the poll, which picks up retries and delayed emails).
        await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, queuedDuringPass ? WAKE_AFTER_QUEUE_MS : config.pollMs); });
        wake = undefined;
        clearTimeout(timer);
      } while (!stopping);
    } finally {
      notificationEmailEvents.off("queued", onQueued);
      clearTimeout(wakeTimer);
      transport.close();
    }
  })();
  return {
    name: "notification-email",
    done,
    async stop() {
      stopping = true;
      clearTimeout(timer);
      clearTimeout(wakeTimer);
      wake?.();
      await done.catch(() => {});
    }
  };
}

async function main() {
  await connectDB();
  const worker = startNotificationEmailWorker({ once: process.argv.includes("--once") });
  const stop = () => { worker.stop(); };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  await worker.done;
  await mongoose.disconnect();
}

if (isMainModule(import.meta.url)) {
  main().catch(async error => { console.error(error); await mongoose.disconnect(); process.exitCode = 1; });
}
