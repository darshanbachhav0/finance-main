import nodemailer from "nodemailer";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
const REQUEST_TIMEOUT_MS = 20000;

// Email transports for notification emails.
// - SMTP: Microsoft 365 (smtp.office365.com:587), Google Workspace / Gmail (smtp.gmail.com) and
//   transactional services with SMTP (Amazon SES, Brevo, Resend...).
// - GMAIL_API: sends as a Gmail account through the Gmail API over HTTPS, for hosts that block
//   outgoing SMTP ports (Render's free plan). Uses an OAuth refresh token with the gmail.send scope.
// - LOG: prints the message instead of sending it (development).
export function createEmailTransport(config, { fetch: fetchImpl = globalThis.fetch } = {}) {
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
  if (config.mode === "GMAIL_API") return gmailApiTransport(config.gmail, fetchImpl);
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

async function googleJson(fetchImpl, url, options) {
  const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

function gmailApiTransport({ clientId, clientSecret, refreshToken }, fetchImpl) {
  // nodemailer only builds the MIME message here (subject/name encoding, HTML + text parts).
  const composer = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
  let token = null;

  async function accessToken() {
    if (token && token.expiresAt > Date.now() + 60000) return token.value;
    const { response, body } = await googleJson(fetchImpl, GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" })
    });
    if (!response.ok || !body.access_token) {
      throw Object.assign(new Error(`Google sign-in for the Gmail API failed (${response.status}): ${body.error || "error"}${body.error_description ? ` - ${body.error_description}` : ""}`), { code: body.error });
    }
    token = { value: body.access_token, expiresAt: Date.now() + (Number(body.expires_in) || 3600) * 1000 };
    return token.value;
  }

  return {
    name: "GMAIL_API",
    async send(message) {
      const { message: raw } = await composer.sendMail(message);
      const { response, body } = await googleJson(fetchImpl, GMAIL_SEND_URL, {
        method: "POST",
        headers: { authorization: `Bearer ${await accessToken()}`, "content-type": "application/json" },
        body: JSON.stringify({ raw: Buffer.from(raw).toString("base64url") })
      });
      if (response.status === 401) token = null;
      if (!response.ok) {
        const reason = body.error?.details?.find?.((item) => item.reason)?.reason || body.error?.status || "";
        throw Object.assign(new Error(`Gmail API refused the email (${response.status}): ${body.error?.message || "error"}`), { code: reason });
      }
      return { messageId: body.id };
    },
    verify: () => accessToken().then(() => true),
    close: () => composer.close()
  };
}
