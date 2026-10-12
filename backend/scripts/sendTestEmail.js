import "dotenv/config";
import { createEmailTransport } from "../src/integrations/email/index.js";
import { composeNotificationEmail, isValidEmail, notificationEmailConfiguration } from "../src/services/notificationEmailService.js";

// Checks the notification-email setup by sending one sample email (no database needed).
//   npm run email:test -- --to=someone@uma.edu.pe
// Without --to the sample goes to SMTP_USER (the sender mailbox itself).
const to = process.argv.find((arg) => arg.startsWith("--to="))?.slice(5) || process.env.SMTP_USER;

function hint(error) {
  const text = `${error?.code || ""} ${error?.responseCode || ""} ${error?.message || ""}`;
  if (/EAUTH|535|534|Username and Password not accepted|Application-specific password required/i.test(text)) {
    return "The SMTP server refused the user/password. Gmail and Microsoft 365 do not accept the normal account password here: for Gmail turn on 2-Step Verification and use a 16-character App Password (https://myaccount.google.com/apppasswords); for Microsoft 365 IT must enable Authenticated SMTP for the mailbox.";
  }
  if (/ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ESOCKET/i.test(text)) return "Could not reach SMTP_HOST:SMTP_PORT. Check the host name, the port (587 with SMTP_SECURE=false, or 465 with SMTP_SECURE=true) and that the network allows outgoing SMTP.";
  return "";
}

async function main() {
  const config = notificationEmailConfiguration();
  if (config.mode === "OFF") throw new Error("NOTIFICATION_EMAIL_MODE is OFF. Set it to SMTP (or LOG to only print the email).");
  if (config.problems.length) throw new Error(config.problems.join("\n"));
  if (!isValidEmail(to)) throw new Error("Pass the recipient with --to=<address>.");
  const transport = createEmailTransport(config);
  try {
    await transport.verify();
    const email = composeNotificationEmail({
      user: { name: "Prueba de configuración" },
      appUrl: config.appUrl,
      notifications: [{ titleKey: "Approval pending", title: "Approval pending", messageKey: "{requestNumber} is waiting for {approvalLevel} approval.", params: { requestNumber: "SOL-PRUEBA", approvalLevel: "AREA_DIRECTOR" }, path: "/" }]
    });
    const info = await transport.send({ from: config.from, replyTo: config.replyTo, to, ...email, subject: `[Prueba] ${email.subject}` });
    console.log(`Test email sent to ${to} through ${transport.name}${config.mode === "SMTP" ? ` (${config.smtp.host}:${config.smtp.port})` : ""}. Message id: ${info?.messageId || "-"}`);
  } finally {
    transport.close();
  }
}

main().catch((error) => {
  console.error(`Test email failed: ${error?.message || error}`);
  const advice = hint(error);
  if (advice) console.error(advice);
  process.exitCode = 1;
});
