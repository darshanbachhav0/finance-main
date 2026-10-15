import { LIMA_TIME_ZONE } from "../../../shared/businessCalendar.mjs";

// Names are stored surnames first ("QUISPE MAMANI MARÍA ELENA"); greetings say "María".
export { greetingName } from "../../../shared/personName.mjs";

// Hour of the day in Lima (0-23), whatever the device's own time zone.
export function limaHour(now = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: LIMA_TIME_ZONE }).format(now));
}

export function greetingTemplate(now = new Date()) {
  const hour = limaHour(now);
  if (hour < 12) return "Good morning, {name}";
  if (hour < 19) return "Good afternoon, {name}";
  return "Good evening, {name}";
}

// The number of things waiting for this person: every task row with a count.
export function pendingTaskCount(items = []) {
  return items.reduce((sum, item) => sum + (Number(item.count) > 0 ? Number(item.count) : 0), 0);
}
