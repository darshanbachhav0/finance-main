import "dotenv/config";
import { createEmailTransport } from "../src/integrations/email/index.js";
import { sendTestNotificationEmail } from "../src/services/notificationEmailService.js";

// Checks the notification-email setup by sending one sample email (no database needed).
//   npm run email:test -- --to=someone@uma.edu.pe
// Without --to the sample goes to SMTP_USER / the sender address. Where there is no shell (Render
// free), use the "Send test email" button in the account menu (administrators) instead.
const to = process.argv.find((arg) => arg.startsWith("--to="))?.slice(5) || process.env.SMTP_USER || process.env.NOTIFICATION_EMAIL_FROM?.match(/<([^>]+)>/)?.[1];

sendTestNotificationEmail({ to, createTransport: createEmailTransport })
  .then((result) => console.log(`Test email sent to ${result.to} through ${result.transport}. Message id: ${result.messageId || "-"}`))
  .catch((error) => {
    console.error(`Test email failed: ${error?.message || error}`);
    if (error?.hint) console.error(error.hint);
    process.exitCode = 1;
  });
