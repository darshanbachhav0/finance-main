import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import notificationsSpanish from "../../shared/notificationTranslations.mjs";
import { notificationCopy, notificationMessage, notificationTitle } from "../src/utils/notificationText.js";

const backendSource = fileURLToPath(new URL("../../backend/src", import.meta.url));
const sourceFiles = directory => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const full = path.join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(full);
  return entry.name.endsWith(".js") ? [full] : [];
});

// Every notificationText( call in the backend must start with a plain string literal,
// otherwise its template cannot be checked (or translated) here.
const templates = new Set();
for (const file of sourceFiles(backendSource)) {
  const source = fs.readFileSync(file, "utf8");
  // "notificationText()" in prose is not a call; the declaration is not either.
  const calls = (source.match(/notificationText\((?!\))/g) || []).length - (source.match(/function notificationText\(/g) || []).length;
  const literals = [...source.matchAll(/notificationText\(\s*"((?:[^"\\]|\\.)*)"/g)].map(match => JSON.parse(`"${match[1]}"`));
  assert.equal(literals.length, calls, `${path.relative(backendSource, file)}: every notificationText() call needs a double-quoted literal template`);
  for (const template of literals) templates.add(template);
}
assert.ok(templates.size >= 80, `Expected the backend notification templates, found ${templates.size}`);

const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
for (const template of templates) {
  assert.ok(Object.hasOwn(notificationsSpanish, template), `Missing Spanish notification copy: ${template}`);
  assert.deepEqual(placeholders(notificationsSpanish[template]), placeholders(template), `Placeholders differ for: ${template}`);
}
for (const key of Object.keys(notificationsSpanish)) assert.ok(templates.has(key), `Unused notification translation: ${key}`);
assert.ok(fs.readFileSync(new URL("../src/context/LanguageContext.jsx", import.meta.url), "utf8").includes("...notificationsSpanish"), "Notification copy is registered in the Spanish dictionary");

// Rendering: translate the template, then fill params; codes and system reasons are translated too.
const spanish = { ...notificationsSpanish, AREA_DIRECTOR: "Director de área" };
const t = text => spanish[text] || text;
const item = {
  title: "Approval pending", titleKey: "Approval pending",
  message: "SOL-7 is waiting for AREA_DIRECTOR approval.", messageKey: "{requestNumber} is waiting for {approvalLevel} approval.",
  params: { requestNumber: "SOL-7", approvalLevel: "AREA_DIRECTOR" }
};
assert.equal(notificationTitle(t, item), "Aprobación pendiente");
assert.equal(notificationMessage(t, item), "SOL-7 está pendiente de aprobación por Director de área.");
assert.equal(notificationMessage(t, { message: "Legacy text" }), "Legacy text", "Old notifications without keys fall back to t(message)");
assert.equal(notificationCopy(t, "{requestNumber}: {comments}", { requestNumber: "SOL-8", comments: "AREA_DIRECTOR" }), "SOL-8: AREA_DIRECTOR", "User comments are not translated");
assert.ok(fs.readFileSync(new URL("../src/layouts/AppLayout.jsx", import.meta.url), "utf8").includes("notificationMessage(t, item)"), "The bell renders translated notification copy");

console.log(`PASS ${templates.size} backend notification templates have Spanish copy with matching placeholders`);
