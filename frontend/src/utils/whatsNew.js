// Release notes for the "What's new" panel, newest first. Each item is an English string with a
// Spanish entry in context/i18n/lively.js. Add a release here when a deploy changes what people see.
export const RELEASES = Object.freeze([
  {
    id: "2026-10-friendly-platform",
    date: "2026-10-14",
    title: "A friendlier platform",
    items: [
      "Drop the supplier's factura (XML or PDF) on a new request and the form fills itself.",
      "Each request shows where it is, who has it and when the payment is expected.",
      "Comment on a request and mention a colleague with @ to ask a question without returning it.",
      "Approve from the email link or swipe on your phone.",
      "Advances show a countdown to the rendition deadline, with reminders 3 days and 1 day before.",
      "Updates arrive live: no need to refresh to see a new approval or payment.",
      "A greeting with your day at a glance, your own numbers and a short tour."
    ]
  }
]);

const STORAGE_KEY = "uma_whats_new_seen";
export const latestReleaseId = () => RELEASES[0]?.id || "";

export function hasUnseenRelease() {
  try { return Boolean(latestReleaseId()) && localStorage.getItem(STORAGE_KEY) !== latestReleaseId(); } catch { return false; }
}

export function markReleasesSeen() {
  try { localStorage.setItem(STORAGE_KEY, latestReleaseId()); } catch { /* Shown as new again next visit. */ }
}
