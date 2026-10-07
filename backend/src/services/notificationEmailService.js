import crypto from "node:crypto";
import Notification from "../models/Notification.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import User from "../models/User.js";
import notificationsSpanish from "../../../shared/notificationTranslations.mjs";

// Emailed copies of bell notifications.
//
// notifyUser() queues a NotificationDelivery when a notification is new or comes back unread. The
// notification-email worker (workers/notificationEmailWorker.js) sends each person one email with
// everything that became due for them, after NOTIFICATION_EMAIL_DELAY_MINUTES: an alert already
// read in the app, resolved (someone else approved) or for a person who turned emails off, is
// skipped instead. A failed send is retried with backoff and never affects the business action.

const MODES = ["OFF", "LOG", "SMTP"];
const PRODUCT_NAME = "UMA · Gestión Financiera";
const MAX_LISTED = 20;
const STALE_CLAIM_MS = 15 * 60 * 1000;
const RETRY_MINUTES = [1, 5, 15, 60];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function boolFromEnv(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function numberFromEnv(value, fallback, min) {
  if (value === undefined || value === null || String(value).trim() === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) && number >= min ? number : fallback;
}

export function isValidEmail(value) {
  return EMAIL_PATTERN.test(String(value || "").trim());
}

export function emailDomain(value) {
  return String(value || "").trim().toLowerCase().split("@")[1] || "";
}

export function notificationEmailConfiguration(env = process.env) {
  const requestedMode = String(env.NOTIFICATION_EMAIL_MODE || "OFF").trim().toUpperCase();
  const mode = MODES.includes(requestedMode) ? requestedMode : "OFF";
  const port = numberFromEnv(env.SMTP_PORT, 587, 1);
  const config = {
    mode,
    from: String(env.NOTIFICATION_EMAIL_FROM || "").trim(),
    replyTo: String(env.NOTIFICATION_EMAIL_REPLY_TO || "").trim() || undefined,
    // Links in the email open the record in the web app (BrowserRouter paths).
    appUrl: String(env.APP_PUBLIC_URL || String(env.CLIENT_URLS || "").split(",")[0] || "").trim().replace(/\/+$/, ""),
    delayMs: numberFromEnv(env.NOTIFICATION_EMAIL_DELAY_MINUTES, 5, 0) * 60 * 1000,
    pollMs: numberFromEnv(env.NOTIFICATION_EMAIL_POLL_MS, 30000, 1000),
    maxAttempts: numberFromEnv(env.NOTIFICATION_EMAIL_MAX_ATTEMPTS, 5, 1),
    usersPerPass: numberFromEnv(env.NOTIFICATION_EMAIL_USERS_PER_PASS, 50, 1),
    // Optional safety net (e.g. "uma.edu.pe"): addresses on other domains are skipped.
    allowedDomains: String(env.NOTIFICATION_EMAIL_ALLOWED_DOMAINS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
    smtp: {
      host: String(env.SMTP_HOST || "").trim(),
      port,
      secure: boolFromEnv(env.SMTP_SECURE, port === 465),
      user: String(env.SMTP_USER || "").trim(),
      password: String(env.SMTP_PASSWORD || "")
    }
  };
  const problems = [];
  if (requestedMode !== mode) problems.push(`Unknown NOTIFICATION_EMAIL_MODE "${requestedMode}" (use OFF, LOG or SMTP).`);
  if (mode !== "OFF" && !/^https?:\/\//i.test(config.appUrl)) problems.push("APP_PUBLIC_URL (or CLIENT_URLS) must be the web app's address for the links in each email.");
  if (mode === "SMTP") {
    if (!config.smtp.host) problems.push("SMTP_HOST is required when NOTIFICATION_EMAIL_MODE=SMTP.");
    if (!isValidEmail(config.from.match(/<([^>]+)>/)?.[1] || config.from)) problems.push("NOTIFICATION_EMAIL_FROM must be the sender address, e.g. \"UMA Finanzas <notificaciones@uma.edu.pe>\".");
    if (config.smtp.user && !config.smtp.password) problems.push("SMTP_PASSWORD is required when SMTP_USER is set.");
  }
  return { ...config, problems, enabled: mode !== "OFF" && !problems.length };
}

// Called by notifyUser() for a new or re-armed notification. Never throws: an email problem must
// not undo or block the approval, payment or review that raised the notification.
export async function queueNotificationEmail(notification, { env = process.env, now = new Date() } = {}) {
  if (!notification?._id || !notification.user) return null;
  const config = notificationEmailConfiguration(env);
  if (!config.enabled) return null;
  try {
    return await NotificationDelivery.findOneAndUpdate(
      { notification: notification._id, channel: "EMAIL", status: "PENDING" },
      { $setOnInsert: { notification: notification._id, user: notification.user, channel: "EMAIL", status: "PENDING", sendAfter: new Date(now.getTime() + config.delayMs) } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  } catch (error) {
    // A concurrent call queued it first.
    if (error?.code !== 11000) console.error("Queueing a notification email failed", error);
    return null;
  }
}

// --- Content ----------------------------------------------------------------------------------

// Params holding codes are shown with their Spanish label (as the bell does with t()).
const CODE_LABELS = {
  AREA_DIRECTOR: "Director de área",
  VICE_RECTOR: "Vicerrector",
  RECTORATE: "Rectorado",
  GENERAL_MANAGEMENT: "Gerencia General",
  COMPLETE: "Completado",
  PENDING: "Pendiente",
  VERIFIED: "Verificada",
  OBSERVED: "Observada",
  REJECTED: "Rechazada",
  LEGACY_ACCEPTED: "Aceptada (histórica)"
};
const CODE_PARAMS = new Set(["approvalLevel", "stage", "verificationStatus"]);
const DATE_TIME_PARAMS = new Set(["dueAt"]);
const limaDateTime = new Intl.DateTimeFormat("es-PE", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Lima" });

function paramValue(name, value) {
  if (value === undefined || value === null) return "";
  if (CODE_PARAMS.has(name)) return CODE_LABELS[value] || String(value);
  if (DATE_TIME_PARAMS.has(name) && !Number.isNaN(new Date(value).getTime())) return limaDateTime.format(new Date(value));
  return String(value);
}

// Same rule as the bell (frontend/src/utils/notificationText.js): translate the stored template,
// then fill in its params. Notifications without a template keep their stored text.
export function spanishNotificationCopy(key, params, fallback) {
  if (!key) return notificationsSpanish[fallback] || fallback || "";
  const template = notificationsSpanish[key] || key;
  return template.replace(/\{(\w+)\}/g, (match, name) => (params && Object.hasOwn(params, name) ? paramValue(name, params[name]) : match));
}

// Roster names are often stored in capitals ("ESCOBAR CHUQUIHUACCHA VERONICA SOFIA").
export function displayName(name) {
  const value = String(name || "").trim().replace(/\s+/g, " ");
  if (!value) return "";
  if (value !== value.toUpperCase()) return value;
  return value.toLocaleLowerCase("es-PE").replace(/(^|[\s'-])(\p{L})/gu, (match, separator, letter) => separator + letter.toLocaleUpperCase("es-PE"));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]);
}

function linkFor(appUrl, path) {
  const target = String(path || "/");
  // Only in-app paths: a stored path can never send someone to another site.
  return `${appUrl}${target.startsWith("/") && !target.startsWith("//") ? target : "/"}`;
}

export function composeNotificationEmail({ user, notifications, appUrl }) {
  const items = [...notifications].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0)).map((item) => ({
    title: spanishNotificationCopy(item.titleKey, item.params, item.title),
    message: spanishNotificationCopy(item.messageKey, item.params, item.message),
    url: linkFor(appUrl, item.path)
  }));
  const listed = items.slice(0, MAX_LISTED);
  const more = items.length - listed.length;
  const name = displayName(user.name);
  const greeting = name ? `Hola, ${name}:` : "Hola:";
  const intro = items.length === 1 ? "Tienes una novedad en el sistema de gestión financiera de la UMA." : `Tienes ${items.length} novedades en el sistema de gestión financiera de la UMA.`;
  const subject = items.length === 1 ? `${items[0].title} · ${PRODUCT_NAME}` : `Tienes ${items.length} novedades · ${PRODUCT_NAME}`;
  const footer = "Recibes este correo porque tienes activadas las notificaciones por correo. Puedes desactivarlas desde el menú de tu cuenta, en el sistema.";
  const security = "Por seguridad, este correo no incluye datos bancarios. Ingresa al sistema con tu usuario para ver el detalle.";

  const text = [
    greeting, "", intro, "",
    ...listed.flatMap((item) => [`• ${item.title}`, `  ${item.message}`, `  Abrir: ${item.url}`, ""]),
    ...(more > 0 ? [`… y ${more} más. Revísalas en ${appUrl}/`, ""] : []),
    security, "", "—", PRODUCT_NAME, footer
  ].join("\n");

  const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:Segoe UI,Arial,sans-serif;color:#1f2933;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="background:#0b3d6e;color:#ffffff;padding:16px 24px;font-size:16px;font-weight:600;">${escapeHtml(PRODUCT_NAME)}</td></tr>
<tr><td style="padding:24px;">
<p style="margin:0 0 8px;font-size:16px;">${escapeHtml(greeting)}</p>
<p style="margin:0 0 20px;font-size:14px;color:#52606d;">${escapeHtml(intro)}</p>
${listed.map((item) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;border:1px solid #e4e7eb;border-radius:6px;"><tr><td style="padding:14px 16px;">
<p style="margin:0 0 4px;font-size:15px;font-weight:600;">${escapeHtml(item.title)}</p>
<p style="margin:0 0 10px;font-size:14px;color:#3e4c59;">${escapeHtml(item.message)}</p>
<a href="${escapeHtml(item.url)}" style="display:inline-block;background:#0b3d6e;color:#ffffff;text-decoration:none;padding:8px 14px;border-radius:4px;font-size:13px;">Abrir en el sistema</a>
</td></tr></table>`).join("\n")}
${more > 0 ? `<p style="margin:0 0 12px;font-size:14px;">… y ${more} más. <a href="${escapeHtml(`${appUrl}/`)}">Revísalas en el sistema</a>.</p>` : ""}
<p style="margin:20px 0 0;font-size:12px;color:#7b8794;">${escapeHtml(security)}</p>
</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e4e7eb;font-size:12px;color:#7b8794;">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`;

  return { subject, text, html };
}

// --- Delivery ---------------------------------------------------------------------------------

function userSkipReason(user, config) {
  if (!user) return "USER_NOT_FOUND";
  if (user.active === false) return "USER_INACTIVE";
  if (user.emailNotifications === false) return "OPTED_OUT";
  if (!isValidEmail(user.email)) return "NO_EMAIL";
  if (config.allowedDomains.length && !config.allowedDomains.includes(emailDomain(user.email))) return "DOMAIN_NOT_ALLOWED";
  return null;
}

function notificationSkipReason(notification) {
  if (!notification) return "NOTIFICATION_DELETED";
  if (notification.resolvedAt) return "RESOLVED";
  if (notification.readAt) return "READ_IN_APP";
  return null;
}

const ids = (rows) => rows.map((row) => row._id);

// Back to PENDING for a retry - unless the notification was re-armed meanwhile and already has a
// newer waiting delivery (unique per notification), which then carries the email.
async function retryOrFail(delivery, error, config, now) {
  const lastError = String(error?.message || error).slice(0, 500);
  if (delivery.attempts >= config.maxAttempts) {
    await NotificationDelivery.updateOne({ _id: delivery._id }, { $set: { status: "FAILED", lastError }, $unset: { claimToken: 1 } });
    return "failed";
  }
  const minutes = RETRY_MINUTES[Math.min(delivery.attempts - 1, RETRY_MINUTES.length - 1)];
  try {
    await NotificationDelivery.updateOne({ _id: delivery._id }, { $set: { status: "PENDING", lastError, sendAfter: new Date(now.getTime() + minutes * 60000) }, $unset: { claimToken: 1, claimedAt: 1 } });
  } catch (updateError) {
    if (updateError?.code !== 11000) throw updateError;
    await NotificationDelivery.updateOne({ _id: delivery._id }, { $set: { status: "SKIPPED", skipReason: "SUPERSEDED", lastError }, $unset: { claimToken: 1 } });
  }
  return "retry";
}

async function deliverToUser(userId, { config, transport, now }) {
  const claimToken = crypto.randomUUID();
  await NotificationDelivery.updateMany(
    { user: userId, channel: "EMAIL", status: "PENDING", sendAfter: { $lte: now } },
    { $set: { status: "SENDING", claimToken, claimedAt: now }, $inc: { attempts: 1 } }
  );
  const deliveries = await NotificationDelivery.find({ claimToken }).lean();
  const result = { sent: 0, skipped: 0, failed: 0, retried: 0, emails: 0 };
  if (!deliveries.length) return result;
  const [user, notifications] = await Promise.all([
    User.findById(userId).select("name email active emailNotifications").lean(),
    Notification.find({ _id: { $in: deliveries.map((item) => item.notification) } }).lean()
  ]);
  const byId = new Map(notifications.map((item) => [String(item._id), item]));
  const userReason = userSkipReason(user, config);
  const skipped = new Map();
  const sendable = [];
  for (const delivery of deliveries) {
    const notification = byId.get(String(delivery.notification));
    const reason = userReason || notificationSkipReason(notification);
    if (reason) skipped.set(reason, [...(skipped.get(reason) || []), delivery]);
    else sendable.push({ delivery, notification });
  }
  for (const [reason, rows] of skipped) {
    await NotificationDelivery.updateMany({ _id: { $in: ids(rows) } }, { $set: { status: "SKIPPED", skipReason: reason }, $unset: { claimToken: 1 } });
    result.skipped += rows.length;
  }
  if (!sendable.length) return result;

  const email = composeNotificationEmail({ user, notifications: sendable.map((item) => item.notification), appUrl: config.appUrl });
  const to = String(user.email).trim().toLowerCase();
  try {
    await transport.send({ from: config.from || `${PRODUCT_NAME} <no-reply@localhost>`, replyTo: config.replyTo, to, ...email });
  } catch (error) {
    console.error(`Notification email to user ${userId} failed: ${error?.message || error}`);
    for (const { delivery } of sendable) {
      if (await retryOrFail(delivery, error, config, now) === "failed") result.failed += 1;
      else result.retried += 1;
    }
    return result;
  }
  await NotificationDelivery.updateMany(
    { _id: { $in: sendable.map((item) => item.delivery._id) } },
    { $set: { status: "SENT", sentAt: new Date(), recipient: to }, $unset: { claimToken: 1, lastError: 1 } }
  );
  result.sent += sendable.length;
  result.emails += 1;
  return result;
}

// One worker pass: every person with deliveries due gets one email listing them.
export async function processNotificationEmails({ env = process.env, transport, now = new Date() } = {}) {
  const config = notificationEmailConfiguration(env);
  const summary = { users: 0, emails: 0, sent: 0, skipped: 0, failed: 0, retried: 0 };
  if (!config.enabled) return summary;
  // A pass that crashed mid-send leaves rows SENDING; after a while they are retried.
  const stale = await NotificationDelivery.find({ status: "SENDING", claimedAt: { $lt: new Date(now.getTime() - STALE_CLAIM_MS) } }).lean();
  for (const delivery of stale) await retryOrFail(delivery, new Error("The sending pass was interrupted."), config, now);

  const userIds = await NotificationDelivery.distinct("user", { channel: "EMAIL", status: "PENDING", sendAfter: { $lte: now } });
  for (const userId of userIds.slice(0, config.usersPerPass)) {
    const result = await deliverToUser(userId, { config, transport, now });
    summary.users += 1;
    for (const key of ["emails", "sent", "skipped", "failed", "retried"]) summary[key] += result[key];
  }
  return summary;
}
