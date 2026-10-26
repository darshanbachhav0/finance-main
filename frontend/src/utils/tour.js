// The first-login guided tour: a few steps, each pointing at an element marked with data-tour.
// Steps whose element is not on screen (a phone hides the sidebar) are skipped.
export const START_TOUR_EVENT = "uma:start-tour";

const STEPS = {
  pulse: { target: "pulse", title: "Your day at a glance", body: "Your greeting sums up what is waiting for you and when your next payment is expected. Your own numbers update as your requests move." },
  tasks: { target: "tasks", title: "Your to-do list", body: "Everything that needs you, most urgent first. Each line opens the exact record." },
  navigation: { target: "navigation", title: "Everything in one menu", body: "Requests, approvals, payments and reports are grouped by area. Counters show what is pending in each one." },
  search: { target: "search", title: "Find anything fast", body: "Press Ctrl K (or /) to search requests, suppliers and pages from anywhere." },
  notifications: { target: "notifications", title: "Alerts that find you", body: "Approvals, payments and comments that mention you appear here as they happen." },
  account: { target: "account", title: "Make it yours", body: "Switch to dark mode, choose your email alerts, set your leave, see what is new or replay this tour." },
  newRequest: { target: "new-request", title: "Start a request", body: "Drop the supplier's factura and the form fills itself. Not sure which track to use? The form helps you choose." },
  approvals: { target: "tasks", title: "Approve in a tap", body: "Requests waiting for you open with their documents. On a phone, swipe a request to approve it." }
};

const ROLE_STEPS = {
  Solicitor: ["pulse", "newRequest", "tasks", "navigation", "search", "notifications", "account"],
  Legal: ["pulse", "newRequest", "tasks", "navigation", "search", "notifications", "account"],
  HumanResources: ["pulse", "newRequest", "tasks", "navigation", "search", "notifications", "account"],
  GAF: ["pulse", "approvals", "navigation", "search", "notifications", "account"],
  AreaDirector: ["pulse", "approvals", "navigation", "search", "notifications", "account"],
  ViceRector: ["pulse", "approvals", "navigation", "search", "notifications", "account"],
  Management: ["pulse", "approvals", "navigation", "search", "notifications", "account"]
};

export function tourStepsFor(role) {
  return (ROLE_STEPS[role] || ["pulse", "tasks", "navigation", "search", "notifications", "account"]).map((key) => ({ key, ...STEPS[key] }));
}

export const tourStorageKey = (userId) => `uma_tour_done_${userId}`;

export function tourDone(userId) {
  try { return localStorage.getItem(tourStorageKey(userId)) === "true"; } catch { return true; }
}

export function markTourDone(userId) {
  try { localStorage.setItem(tourStorageKey(userId), "true"); } catch { /* The tour simply offers itself again next time. */ }
}

const CARD_WIDTH = 340;
export const CARD_HEIGHT = 270;
const GAP = 12;
const EDGE = 16;

// Where the explanation card goes: below the highlighted element, else above it, else beside it
// (a tall element such as the menu), else at the bottom of the screen - always fully visible.
export function cardPosition(rect, cardHeight = CARD_HEIGHT, viewport = { width: window.innerWidth, height: window.innerHeight }) {
  const width = Math.min(CARD_WIDTH, viewport.width - EDGE * 2);
  const clampLeft = (value) => Math.max(EDGE, Math.min(value, viewport.width - width - EDGE));
  const clampTop = (value) => Math.max(EDGE, Math.min(value, viewport.height - cardHeight - EDGE));
  const bottom = rect.top + rect.height;
  if (viewport.height - bottom - GAP >= cardHeight + EDGE) return { top: bottom + GAP, left: clampLeft(rect.left) };
  if (rect.top - GAP >= cardHeight + EDGE) return { top: rect.top - GAP - cardHeight, left: clampLeft(rect.left) };
  const right = rect.left + rect.width;
  if (viewport.width - right - GAP >= width + EDGE) return { top: clampTop(rect.top), left: right + GAP };
  if (rect.left - GAP >= width + EDGE) return { top: clampTop(rect.top), left: rect.left - GAP - width };
  return { top: clampTop(viewport.height - cardHeight - EDGE), left: clampLeft((viewport.width - width) / 2) };
}

export function startTour() {
  window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
}
