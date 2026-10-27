// Payment priority of a request (Manual del usuario, "Elige la prioridad"; Manual técnico,
// "Programación de pagos"). It decides the payment window Treasury is offered:
// P1 Crítica: today. P2 Urgente: the weekly urgency window (next Wednesday).
// P3 Normal: the next fortnightly payment day at least the cut-off working days away.
// P4 Programada: the last fortnightly payment day before the agreed due date.
// P1 and P2 need a written justification of the urgency.
export const REQUEST_PRIORITY = Object.freeze({ CRITICAL: "P1", URGENT: "P2", NORMAL: "P3", SCHEDULED: "P4" });
export const REQUEST_PRIORITIES = Object.freeze(Object.values(REQUEST_PRIORITY));
export const DEFAULT_REQUEST_PRIORITY = REQUEST_PRIORITY.NORMAL;
// Sorting by priority sorts by this rank: P1 first.
export const REQUEST_PRIORITY_RANK = Object.freeze({ P1: 4, P2: 3, P3: 2, P4: 1 });
export const URGENT_PRIORITIES = Object.freeze([REQUEST_PRIORITY.CRITICAL, REQUEST_PRIORITY.URGENT]);

// The former Alta / Media / Baja scale: Alta becomes Urgente, the others Normal.
export const LEGACY_REQUEST_PRIORITY_MAP = Object.freeze({ ALTA: "P2", MEDIA: "P3", BAJA: "P3" });

export function normalizeRequestPriority(value) {
  const code = String(value ?? "").trim().toUpperCase();
  return LEGACY_REQUEST_PRIORITY_MAP[code] || code;
}

export function priorityNeedsJustification(priority) {
  return URGENT_PRIORITIES.includes(normalizeRequestPriority(priority));
}
