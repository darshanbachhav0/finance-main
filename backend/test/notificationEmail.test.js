import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Notification from "../src/models/Notification.js";
import NotificationDelivery from "../src/models/NotificationDelivery.js";
import User from "../src/models/User.js";
import { markNotificationRead, notificationText, notifyUser, resolveNotification } from "../src/services/notificationService.js";
import { createEmailTransport } from "../src/integrations/email/index.js";
import { composeNotificationEmail, displayName, emailErrorHint, maskedEmail, notificationEmailConfiguration, processNotificationEmails, skipExplanation, spanishNotificationCopy } from "../src/services/notificationEmailService.js";

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
      assert.deepEqual(summary.skipReasons, { OPTED_OUT: 1, NO_EMAIL: 1 }, "the pass summary says why emails were skipped");
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

test("SMTP gives up quickly on a server that never answers, and on Render says what to change", { timeout: 20000 }, async () => {
  const net = await import("node:net");
  // Accepts the connection but never greets, like a blocked / black-holed SMTP port.
  const sockets = new Set();
  const silent = net.createServer((socket) => { sockets.add(socket); socket.on("error", () => {}); });
  await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
  const env = { ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "SMTP", SMTP_HOST: "127.0.0.1", SMTP_PORT: String(silent.address().port), SMTP_SECURE: "false", SMTP_TIMEOUT_MS: "300", NOTIFICATION_EMAIL_FROM: "UMA Finanzas <sender@gmail.com>" };
  try {
    const config = notificationEmailConfiguration(env);
    assert.equal(config.enabled, true);
    assert.equal(notificationEmailConfiguration(EMAIL_ENV).smtp.timeoutMs, 10000, "10 s by default");
    const transport = createEmailTransport(config);
    const started = Date.now();
    const error = await transport.send({ from: config.from, to: "ana@uma.edu.pe", subject: "x", text: "x" }).then(() => null, (failure) => failure);
    transport.close();
    assert.ok(error, "the send fails");
    assert.ok(Date.now() - started < 5000, "within seconds, not nodemailer's 2-minute default");
    assert.match(emailErrorHint(error, config), /Could not reach the SMTP server/);

    // On Render, ports 25/465/587 are blocked on the free plan: a startup warning and a specific fix.
    const render = notificationEmailConfiguration({ ...env, RENDER: "true", SMTP_PORT: "587" });
    assert.match(render.warnings[0], /free plan blocks outgoing SMTP/);
    assert.match(emailErrorHint(error, render), /port 2525/);
    assert.match(emailErrorHint(error, render), /smtp-relay\.brevo\.com/);
    assert.deepEqual(notificationEmailConfiguration({ ...env, RENDER: "true", SMTP_PORT: "2525" }).warnings, [], "port 2525 is not blocked");
    assert.deepEqual(notificationEmailConfiguration({ ...env, SMTP_PORT: "587" }).warnings, [], "no Render warning elsewhere");
    assert.match(emailErrorHint({ code: "EAUTH", message: "535-5.7.8 Username and Password not accepted" }, render), /App Password/);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => silent.close(resolve));
  }
});

test("every skipped email is explained in the logs, with the address masked", () => {
  assert.equal(maskedEmail("Abhiraj.K@gmail.com"), "ab***@gmail.com");
  assert.equal(maskedEmail(""), "(none)");
  const gated = notificationEmailConfiguration({ ...EMAIL_ENV, NOTIFICATION_EMAIL_ALLOWED_DOMAINS: "uma.edu.pe" });
  const domain = skipExplanation("DOMAIN_NOT_ALLOWED", { email: "abhiraj@gmail.com" }, gated);
  assert.match(domain, /ab\*\*\*@gmail\.com is not on NOTIFICATION_EMAIL_ALLOWED_DOMAINS=uma\.edu\.pe/);
  assert.match(domain, /clear that variable/);
  assert.match(skipExplanation("READ_IN_APP", {}, gated), /5-minute wait/);
  assert.match(skipExplanation("NO_EMAIL", {}, gated), /User Administration/);
  assert.match(skipExplanation("OPTED_OUT", {}, gated), /Notificaciones por correo/);
  // Without NOTIFICATION_EMAIL_ALLOWED_DOMAINS any address saved on the user is emailed.
  assert.deepEqual(notificationEmailConfiguration(EMAIL_ENV).allowedDomains, []);
});

test("a deployment still set to the removed GMAIL_API mode keeps sending through its SMTP settings", () => {
  const smtp = { SMTP_HOST: "smtp-relay.brevo.com", SMTP_PORT: "2525", SMTP_SECURE: "false", SMTP_USER: "login@smtp-brevo.com", SMTP_PASSWORD: "key", NOTIFICATION_EMAIL_FROM: "UMA Finanzas <sender@gmail.com>" };
  const legacy = notificationEmailConfiguration({ ...EMAIL_ENV, ...smtp, NOTIFICATION_EMAIL_MODE: "GMAIL_API", RENDER: "true" });
  assert.equal(legacy.mode, "SMTP");
  assert.equal(legacy.enabled, true);
  assert.deepEqual(legacy.problems, []);
  assert.equal(legacy.warnings.length, 1, "port 2525 is fine on Render; only the mode is reported");
  assert.match(legacy.warnings[0], /GMAIL_API is no longer supported; sending through SMTP \(smtp-relay\.brevo\.com:2525\)/);
  // Without SMTP settings, or with any other unknown mode, emails stay off and say why.
  const bare = notificationEmailConfiguration({ ...EMAIL_ENV, NOTIFICATION_EMAIL_MODE: "GMAIL_API" });
  assert.equal(bare.enabled, false);
  assert.match(bare.problems[0], /Unknown NOTIFICATION_EMAIL_MODE "GMAIL_API".*emails are OFF/);
  assert.equal(notificationEmailConfiguration({ ...EMAIL_ENV, ...smtp, NOTIFICATION_EMAIL_MODE: "PIGEON" }).enabled, false);
});

test("emails go out about a second after the notification, without waiting for the poll", { timeout: 30000 }, async () => {
  const { startNotificationEmailWorker } = await import("../src/workers/notificationEmailWorker.js");
  assert.equal(notificationEmailConfiguration({ NOTIFICATION_EMAIL_MODE: "LOG", APP_PUBLIC_URL: "https://x.test" }).delayMs, 0, "no delay by default");
  const database = `erp_notification_email_now_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${database}`, { serverSelectionTimeoutMS: 5000 });
  // A 60 s poll: only the "queued" wake-up can explain a send within a few seconds.
  const env = { NOTIFICATION_EMAIL_MODE: "LOG", APP_PUBLIC_URL: "https://finanzas.uma.test", NOTIFICATION_EMAIL_POLL_MS: "60000" };
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  delete process.env.NOTIFICATION_EMAIL_DELAY_MINUTES;
  Object.assign(process.env, env);
  const lines = [];
  const log = console.log;
  console.log = (...args) => { lines.push(args.join(" ")); };
  let worker;
  try {
    await Promise.all([Notification.init(), NotificationDelivery.init()]);
    const abhiraj = await User.create({ name: "Abhiraj", email: "abhiraj@uma.edu.pe", passwordHash: "unused" });
    worker = startNotificationEmailWorker({ env: process.env });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const started = Date.now();
    // One action raising two notifications for the same person (e.g. approval + budget alert).
    await notifyUser({ userId: abhiraj._id, eventKey: "req:now:approval", type: "APPROVAL_PENDING", title: notificationText("Approval pending"), message: notificationText("{requestNumber} is waiting for {approvalLevel} approval.", { requestNumber: "SOL-1", approvalLevel: "AREA_DIRECTOR" }), path: "/approvals" });
    await notifyUser({ userId: abhiraj._id, eventKey: "req:now:budget", type: "BUDGET_EXCEPTION", title: "Budget exception pending", message: "SOL-1", path: "/budget" });
    let sent = 0;
    while (Date.now() - started < 10000) {
      sent = await NotificationDelivery.countDocuments({ user: abhiraj._id, status: "SENT" });
      if (sent === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    const elapsed = Date.now() - started;
    assert.equal(sent, 2);
    assert.ok(elapsed < 5000, `sent ${elapsed} ms after the notification`);
    assert.equal(lines.filter((line) => line.startsWith("[notification-email] LOG")).length, 1, "both notifications in one email");
    assert.ok(lines.some((line) => /Notification email sent to Abhiraj \(ab\*\*\*@uma\.edu\.pe\): 2 notification/.test(line)));
  } finally {
    await worker?.stop();
    console.log = log;
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    if (mongoose.connection.name === database) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
