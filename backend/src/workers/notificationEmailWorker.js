import "dotenv/config";
import mongoose from "mongoose";
import { isMainModule } from "./isMainModule.js";
import { connectDB } from "../config/db.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import { createEmailTransport } from "../integrations/email/index.js";
import { notificationEmailConfiguration, processNotificationEmails } from "../services/notificationEmailService.js";

// Sends the queued notification emails (services/notificationEmailService.js) on an already-open
// Mongoose connection until stop() is called. Each pass claims a person's due deliveries with a
// unique token, so a second process never emails the same delivery twice.
export function startNotificationEmailWorker({ once = false, env = process.env } = {}) {
  const config = notificationEmailConfiguration(env);
  let stopping = false;
  let timer;
  let wake;
  const done = (async () => {
    if (!config.enabled) {
      console.log(config.mode === "OFF" ? "Notification email worker: NOTIFICATION_EMAIL_MODE=OFF, nothing to send." : `Notification email worker not started: ${config.problems.join(" ")}`);
      return;
    }
    const transport = createEmailTransport(config);
    console.log(`Notification email worker: ${transport.name} every ${config.pollMs}ms; emails wait ${config.delayMs / 60000} min so alerts read in the app are not emailed`);
    await NotificationDelivery.createIndexes();
    try {
      do {
        try {
          const summary = await processNotificationEmails({ env, transport });
          if (summary.users) console.log("Notification email pass", summary);
        } catch (error) { console.error("Notification email pass failed", error); if (once) throw error; }
        if (once || stopping) break;
        await new Promise(resolve => { wake = resolve; timer = setTimeout(resolve, config.pollMs); });
      } while (!stopping);
    } finally {
      transport.close();
    }
  })();
  return {
    name: "notification-email",
    done,
    async stop() {
      stopping = true;
      clearTimeout(timer);
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
