import nodemailer from "nodemailer";

// Email transports for notification emails. SMTP covers Microsoft 365 (smtp.office365.com:587),
// Google Workspace (smtp-relay.gmail.com / smtp.gmail.com) and transactional services that offer
// SMTP (Amazon SES, Brevo, Resend...). LOG prints the message instead of sending it (development).
export function createEmailTransport(config) {
  if (config.mode === "SMTP") {
    const transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      // false = STARTTLS on 587; true = implicit TLS on 465. Plain text is never accepted.
      secure: config.smtp.secure,
      requireTLS: !config.smtp.secure,
      auth: config.smtp.user ? { user: config.smtp.user, pass: config.smtp.password } : undefined
    });
    return {
      name: "SMTP",
      send: (message) => transporter.sendMail(message),
      verify: () => transporter.verify(),
      close: () => transporter.close()
    };
  }
  if (config.mode === "LOG") {
    return {
      name: "LOG",
      async send(message) {
        console.log(`[notification-email] LOG (not sent) to=${message.to} subject=${JSON.stringify(message.subject)}\n${message.text}`);
        return { messageId: "log" };
      },
      async verify() { return true; },
      close() {}
    };
  }
  throw new Error(`No email transport for NOTIFICATION_EMAIL_MODE=${config.mode}.`);
}
