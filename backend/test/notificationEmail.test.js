import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Notification from "../src/models/Notification.js";
import NotificationDelivery from "../src/models/NotificationDelivery.js";
import User from "../src/models/User.js";
import { markNotificationRead, notificationText, notifyUser, resolveNotification } from "../src/services/notificationService.js";
import { createEmailTransport } from "../src/integrations/email/index.js";
import { composeNotificationEmail, displayName, emailErrorHint, notificationEmailConfiguration, processNotificationEmails, sendTestNotificationEmail, spanishNotificationCopy } from "../src/services/notificationEmailService.js";

const EMAIL_ENV = { NOTIFICATION_EMAIL_MODE: "LOG", APP_PUBLIC_URL: "https://finanzas.uma.test/", NOTIFICATION_EMAIL_DELAY_MINUTES: "5" };

test("notification email configuration is off by default and refuses an incomplete SMTP setup", () => {
  assert.equal(notificationEmailConfiguration({}).enabled, false);
  assert.equal(notificationEmailConfiguration({}).mode, "OFF");
  const log = notificationEmailConfiguration(EMAIL_ENV);
  assert.equal(log.enabled, true);
  assert.equal(log.appUrl, "https://finanzas.uma.test", "trailing slash removed");
  assert.equal(log.delayMs, 5 * 60000);
  assert.equal(notificationEmailConfiguration({ NOTIFICATION_EMAIL_MODE: "LOG", CLIENT_URLS: "http://localhost:5174,http://127.0.0.1:5174" }).appUrl, "http://localhost:5174");
  const smtp = notificationEmailConfiguration({ ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "SMTP" });
  assert.equal(smtp.enabled, false);
  assert.ok(smtp.problems.some((problem) => problem.includes("SMTP_HOST")));
  assert.ok(smtp.problems.some((problem) => problem.includes("NOTIFICATION_EMAIL_FROM")));
  const ready = notificationEmailConfiguration({ ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "smtp", SMTP_HOST: "smtp.office365.com", SMTP_USER: "notificaciones@uma.edu.pe", SMTP_PASSWORD: "x", NOTIFICATION_EMAIL_FROM: "UMA Finanzas <notificaciones@uma.edu.pe>" });
  assert.equal(ready.enabled, true);
  assert.equal(ready.smtp.port, 587);
  assert.equal(ready.smtp.secure, false, "587 uses STARTTLS");
  assert.equal(notificationEmailConfiguration({ ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "PIGEON" }).enabled, false);
});

test("notification emails are personal, in Spanish, escaped and link only into the app", () => {
  assert.equal(displayName("ESCOBAR CHUQUIHUACCHA VERÓNICA SOFÍA"), "Escobar Chuquihuaccha Verónica Sofía");
  assert.equal(displayName("Ana Torres"), "Ana Torres", "a name already written in mixed case is kept");
  assert.equal(spanishNotificationCopy("{requestNumber} is waiting for {approvalLevel} approval.", { requestNumber: "SOL-7", approvalLevel: "AREA_DIRECTOR" }), "SOL-7 está pendiente de aprobación por Director de área.");
  assert.equal(spanishNotificationCopy(undefined, undefined, "Legacy text"), "Legacy text");
  const single = composeNotificationEmail({
    user: { name: "MORAN PAREDES GLADYS" },
    appUrl: "https://finanzas.uma.test",
    notifications: [{ titleKey: "Approval pending", title: "Approval pending", messageKey: "{requestNumber} is waiting for {approvalLevel} approval.", params: { requestNumber: "SOL-<b>9</b>", approvalLevel: "GENERAL_MANAGEMENT" }, path: "/approvals?request=abc" }]
  });
  assert.equal(single.subject, "Aprobación pendiente · UMA · Gestión Financiera");
  assert.match(single.text, /^Hola, Moran Paredes Gladys:/);
  assert.match(single.text, /SOL-<b>9<\/b> está pendiente de aprobación por Gerencia General\./);
  assert.match(single.text, /https:\/\/finanzas\.uma\.test\/approvals\?request=abc/);
  assert.ok(single.html.includes("SOL-&lt;b&gt;9&lt;/b&gt;"), "params are HTML-escaped");
  assert.ok(!single.html.includes("<b>9</b>"));
  const several = composeNotificationEmail({
    user: { name: "Ana" },
    appUrl: "https://finanzas.uma.test",
    notifications: [
      { title: "Second", message: "b", path: "https://evil.example/phish", createdAt: new Date("2026-10-02") },
      { title: "First", message: "a", path: "//evil.example", createdAt: new Date("2026-10-01") }
    ]
  });
  assert.equal(several.subject, "Tienes 2 novedades · UMA · Gestión Financiera");
  assert.ok(several.text.indexOf("First") < several.text.indexOf("Second"), "oldest first");
  assert.ok(!several.text.includes("evil.example") && !several.html.includes("evil.example"), "a stored path never links outside the app");
});

test("bell notifications are emailed once per person, after the delay, unless read, resolved or switched off", { timeout: 60000 }, async (t) => {
  const database = `erp_notification_email_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  const saved = Object.fromEntries(Object.keys(EMAIL_ENV).map((key) => [key, process.env[key]]));
  Object.assign(process.env, EMAIL_ENV);
  const sent = [];
  let failNext = 0;
  const transport = { name: "TEST", async send(message) { if (failNext > 0) { failNext -= 1; throw new Error("SMTP 451 try later"); } sent.push(message); } };
  const later = (minutes) => new Date(Date.now() + minutes * 60000);
  try {
    await Promise.all([Notification.init(), NotificationDelivery.init()]);
    const ana = await User.create({ name: "TORRES DIAZ ANA", email: "ana.torres@uma.edu.pe", passwordHash: "unused" });
    const luis = await User.create({ name: "Luis Pérez", email: "luis.perez@uma.edu.pe", passwordHash: "unused", emailNotifications: false });
    const noEmail = await User.create({ name: "Sin Correo", passwordHash: "unused" });
    const approval = (userId, eventKey, requestNumber) => notifyUser({ userId, eventKey, type: "APPROVAL_PENDING", title: notificationText("Approval pending"), message: notificationText("{requestNumber} is waiting for {approvalLevel} approval.", { requestNumber, approvalLevel: "AREA_DIRECTOR" }), path: "/approvals" });

    await t.test("each new notification is queued once; refreshing an unread one does not queue it again", async () => {
      const first = await approval(ana._id, "req:1:approval", "SOL-1");
      assert.equal(first.title, "Approval pending", "notifyUser still returns the stored notification");
      await approval(ana._id, "req:1:approval", "SOL-1");
      await approval(ana._id, "req:2:approval", "SOL-2");
      await approval(luis._id, "req:3:approval", "SOL-3");
      await approval(noEmail._id, "req:4:approval", "SOL-4");
      assert.equal(await NotificationDelivery.countDocuments({ user: ana._id }), 2);
      assert.equal(await NotificationDelivery.countDocuments(), 4);
    });

    await t.test("nothing is sent before the delay; then each person gets one email with all their news", async () => {
      assert.equal((await processNotificationEmails({ env: process.env, transport })).emails, 0);
      const summary = await processNotificationEmails({ env: process.env, transport, now: later(6) });
      assert.equal(sent.length, 1);
      assert.equal(sent[0].to, "ana.torres@uma.edu.pe");
      assert.equal(sent[0].subject, "Tienes 2 novedades · UMA · Gestión Financiera");
      assert.match(sent[0].text, /Hola, Torres Diaz Ana:/);
      assert.match(sent[0].text, /SOL-1 está pendiente de aprobación por Director de área\./);
      assert.match(sent[0].text, /SOL-2/);
      assert.deepEqual({ sent: summary.sent, skipped: summary.skipped }, { sent: 2, skipped: 2 });
      assert.equal((await NotificationDelivery.findOne({ user: luis._id })).skipReason, "OPTED_OUT");
      assert.equal((await NotificationDelivery.findOne({ user: noEmail._id })).skipReason, "NO_EMAIL");
      assert.equal((await processNotificationEmails({ env: process.env, transport, now: later(7) })).emails, 0, "already sent");
    });

    await t.test("an alert read in the app or resolved before the delay is not emailed", async () => {
      sent.length = 0;
      const read = await approval(ana._id, "req:5:approval", "SOL-5");
      await approval(ana._id, "req:6:approval", "SOL-6");
      await markNotificationRead(read._id, ana._id);
      await resolveNotification("req:6:approval");
      const summary = await processNotificationEmails({ env: process.env, transport, now: later(6) });
      assert.equal(sent.length, 0);
      assert.equal(summary.skipped, 2);
      assert.deepEqual((await NotificationDelivery.find({ notification: read._id })).map((row) => row.skipReason), ["READ_IN_APP"]);
    });

    await t.test("a notification that comes back after being read is emailed again", async () => {
      sent.length = 0;
      await approval(ana._id, "req:5:approval", "SOL-5");
      await processNotificationEmails({ env: process.env, transport, now: later(6) });
      assert.equal(sent.length, 1);
      assert.match(sent[0].subject, /^Aprobación pendiente/);
    });

    await t.test("a failed send is retried with backoff and gives up after the maximum attempts", async () => {
      sent.length = 0;
      const env = { ...process.env, NOTIFICATION_EMAIL_MAX_ATTEMPTS: "2" };
      await approval(ana._id, "req:7:approval", "SOL-7");
      failNext = 1;
      let summary = await processNotificationEmails({ env, transport, now: later(6) });
      assert.equal(summary.retried, 1);
      let delivery = await NotificationDelivery.findOne({ status: { $in: ["PENDING", "FAILED"] } });
      assert.equal(delivery.status, "PENDING");
      assert.match(delivery.lastError, /451/);
      assert.ok(delivery.sendAfter > later(6), "retried later, not immediately");
      failNext = 1;
      summary = await processNotificationEmails({ env, transport, now: later(30) });
      assert.equal(summary.failed, 1);
      delivery = await NotificationDelivery.findById(delivery._id);
      assert.equal(delivery.status, "FAILED");
      assert.equal(sent.length, 0);
    });

    await t.test("with emails off nothing is queued", async () => {
      process.env.NOTIFICATION_EMAIL_MODE = "OFF";
      const before = await NotificationDelivery.countDocuments();
      await approval(ana._id, "req:8:approval", "SOL-8");
      assert.equal(await NotificationDelivery.countDocuments(), before);
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});

const GMAIL_ENV = { ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "GMAIL_API", GMAIL_CLIENT_ID: "client.apps.googleusercontent.com", GMAIL_CLIENT_SECRET: "secret", GMAIL_REFRESH_TOKEN: "refresh", NOTIFICATION_EMAIL_FROM: "UMA Finanzas <sender@gmail.com>" };

test("Gmail API mode sends over HTTPS with a refresh token (for hosts that block SMTP, e.g. Render free)", async () => {
  const incomplete = notificationEmailConfiguration({ ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "GMAIL_API" });
  assert.equal(incomplete.enabled, false);
  for (const key of ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "NOTIFICATION_EMAIL_FROM"]) assert.ok(incomplete.problems.some((problem) => problem.includes(key)), key);
  const config = notificationEmailConfiguration(GMAIL_ENV);
  assert.equal(config.enabled, true);

  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.includes("oauth2.googleapis.com/token")) return { ok: true, status: 200, json: async () => ({ access_token: "access-1", expires_in: 3600 }) };
    return { ok: true, status: 200, json: async () => ({ id: `gmail-${calls.length}` }) };
  };
  const transport = createEmailTransport(config, { fetch });
  assert.equal(transport.name, "GMAIL_API");
  const email = composeNotificationEmail({ user: { name: "Ana" }, appUrl: config.appUrl, notifications: [{ title: "Aprobación pendiente", message: "SOL-1", path: "/approvals" }] });
  const first = await transport.send({ from: config.from, to: "ana.torres@uma.edu.pe", ...email });
  await transport.send({ from: config.from, to: "luis@uma.edu.pe", ...email });
  assert.equal(first.messageId, "gmail-2");
  assert.equal(calls.filter((call) => call.url.includes("/token")).length, 1, "the access token is reused while valid");
  const tokenBody = new URLSearchParams(calls[0].options.body);
  assert.deepEqual([tokenBody.get("grant_type"), tokenBody.get("refresh_token"), tokenBody.get("client_id")], ["refresh_token", "refresh", "client.apps.googleusercontent.com"]);
  const sendCall = calls[1];
  assert.equal(sendCall.url, "https://gmail.googleapis.com/gmail/v1/users/me/messages/send");
  assert.equal(sendCall.options.headers.authorization, "Bearer access-1");
  const raw = Buffer.from(JSON.parse(sendCall.options.body).raw, "base64url").toString("utf8");
  assert.match(raw, /^To: ana\.torres@uma\.edu\.pe$/m);
  assert.match(raw, /^From: UMA Finanzas <sender@gmail\.com>$/m);
  assert.match(raw, /^Subject: =\?UTF-8\?/m, "the Spanish subject is MIME-encoded");
  assert.match(raw, /text\/html/);
  transport.close();

  const refused = createEmailTransport(config, { fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: "invalid_grant", error_description: "Token has been expired or revoked." }) }) });
  await assert.rejects(refused.verify(), (error) => error.code === "invalid_grant" && /expired or revoked/.test(error.message));
  assert.match(emailErrorHint({ code: "invalid_grant" }), /Testing/);
  assert.match(emailErrorHint({ code: "ETIMEDOUT", message: "Connection timeout" }), /Render's free plan blocks outgoing SMTP/);
  assert.match(emailErrorHint({ code: "EAUTH", message: "535-5.7.8 Username and Password not accepted" }), /App Password/);
});

test("the setup check sends one sample email with the live configuration and explains failures", async () => {
  const sent = [];
  const fake = (config) => ({ name: config.mode, async send(message) { sent.push(message); return { messageId: "m1" }; }, close() {} });
  const result = await sendTestNotificationEmail({ to: "admin@uma.edu.pe", env: EMAIL_ENV, createTransport: fake });
  assert.deepEqual(result, { to: "admin@uma.edu.pe", transport: "LOG", messageId: "m1" });
  assert.match(sent[0].subject, /^\[Prueba\] Aprobación pendiente/);
  await assert.rejects(sendTestNotificationEmail({ to: "admin@uma.edu.pe", env: {}, createTransport: fake }), /off/);
  await assert.rejects(sendTestNotificationEmail({ to: "admin@uma.edu.pe", env: { ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "GMAIL_API" }, createTransport: fake }), /GMAIL_REFRESH_TOKEN/);
  const failing = () => ({ name: "SMTP", async send() { throw Object.assign(new Error("connect ETIMEDOUT 1.2.3.4:587"), { code: "ETIMEDOUT" }); }, close() {} });
  await assert.rejects(sendTestNotificationEmail({ to: "admin@uma.edu.pe", env: EMAIL_ENV, createTransport: failing }), (error) => /Render/.test(error.hint));
});

test("administrators can send a test email from the app; other roles cannot", { timeout: 60000 }, async () => {
  const { default: app } = await import("../src/app.js");
  const { default: jwt } = await import("jsonwebtoken");
  const database = `erp_notification_test_email_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.on("listening", resolve));
  const saved = Object.fromEntries(Object.keys(EMAIL_ENV).map((key) => [key, process.env[key]]));
  try {
    const admin = await User.create({ name: "Admin", dni: "70000001", email: "admin@uma.edu.pe", passwordHash: "unused", role: "Admin" });
    const solicitor = await User.create({ name: "Solicitante", dni: "70000002", email: "sol@uma.edu.pe", passwordHash: "unused", role: "Solicitor" });
    const post = (user) => fetch(`http://127.0.0.1:${server.address().port}/api/notifications/test-email`, {
      method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me")}` }, body: "{}"
    });
    delete process.env.NOTIFICATION_EMAIL_MODE;
    const off = await post(admin);
    assert.equal(off.status, 502);
    assert.match((await off.json()).message, /off/);
    Object.assign(process.env, EMAIL_ENV);
    assert.equal((await post(solicitor)).status, 403);
    const sent = await post(admin);
    assert.equal(sent.status, 200);
    assert.deepEqual((await sent.json()).data, { to: "admin@uma.edu.pe", transport: "LOG", messageId: "log" });
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await new Promise((resolve) => server.close(resolve));
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
