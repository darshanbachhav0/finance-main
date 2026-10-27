import assert from "node:assert/strict";
import test from "node:test";
import "../src/config/timeZone.js";
import { addBusinessDays, businessDaysBetween, calendarDateKey, isBusinessDay, isPaymentCycleDate, isUrgencyPaymentDate, lastWorkingDayOfMonth, limaDateKey, limaToday, nextBusinessDay, nextPaymentCycleDate, nextUrgencyPaymentDate, paymentCycleDatesFrom, peruHolidays, suggestedPaymentDate } from "../../shared/businessCalendar.mjs";

const lima = (date, time = "09:00") => new Date(`${date}T${time}:00-05:00`);

test("Lima time: today and the calendar day of stored dates", () => {
  assert.equal(process.env.TZ, "America/Lima", "the server process runs on Lima time");
  assert.equal(limaToday(new Date("2026-11-01T03:00:00Z")), "2026-10-31", "22:00 in Lima is still 31 October (UTC is already November)");
  assert.equal(calendarDateKey("2026-10-13"), "2026-10-13");
  assert.equal(calendarDateKey(new Date("2026-10-13T00:00:00.000Z")), "2026-10-13", "date-only values keep their day");
  assert.equal(calendarDateKey("2026-10-14T03:30:00.000Z"), "2026-10-13", "instants are read in Lima");
  assert.equal(calendarDateKey("not a date"), "");
});

test("business calendar: Peruvian holidays, weekends, Lima time, the fortnightly payment days and P1-P4 windows", () => {
  const holidays2026 = peruHolidays(2026).map((item) => item.date);
  assert.ok(holidays2026.includes("2026-04-02") && holidays2026.includes("2026-04-03"), "Holy Thursday and Good Friday 2026");
  assert.ok(holidays2026.includes("2026-07-28") && holidays2026.includes("2026-12-09"));
  assert.equal(peruHolidays(2021).some((item) => item.date === "2021-12-09"), false, "Ayacucho is a holiday only from 2022");

  assert.equal(isBusinessDay(lima("2026-09-25")), true, "Friday");
  assert.equal(isBusinessDay(lima("2026-09-26")), false, "Saturday");
  assert.equal(isBusinessDay(lima("2026-10-08")), false, "Angamos");
  assert.equal(isBusinessDay(lima("2026-09-28"), { extraHolidays: ["2026-09-28"] }), false, "configured closure");
  assert.equal(limaDateKey(new Date("2026-09-26T03:00:00Z")), "2026-09-25", "22:00 Friday in Lima is still Friday");

  assert.equal(limaDateKey(addBusinessDays(lima("2026-09-25"), 1)), "2026-09-28", "Friday + 1 skips the weekend");
  assert.equal(limaDateKey(addBusinessDays(lima("2026-10-07"), 1)), "2026-10-09", "skips the 8 October holiday");
  assert.equal(limaDateKey(addBusinessDays(lima("2026-09-26"), 1)), "2026-09-29", "a Saturday start counts from Monday");
  assert.equal(addBusinessDays(lima("2026-09-25", "14:30"), 2).toISOString(), lima("2026-09-29", "14:30").toISOString(), "keeps the time of day");
  assert.equal(limaDateKey(addBusinessDays(lima("2026-07-24"), 10)), "2026-08-12", "10 working days across Fiestas Patrias and Junín");
  assert.equal(limaDateKey(nextBusinessDay(lima("2026-12-25"))), "2026-12-28");
  assert.equal(businessDaysBetween(lima("2026-09-25"), lima("2026-09-30")), 3);

  // Payment days: the 15th and the last day of the month, each moved back to the previous working
  // day (Manual técnico, "Programación de pagos").
  assert.equal(nextPaymentCycleDate(lima("2026-09-03")), "2026-09-15");
  assert.equal(nextPaymentCycleDate(lima("2026-09-16")), "2026-09-30");
  assert.equal(nextPaymentCycleDate(lima("2026-10-27")), "2026-10-30", "Saturday 31 October moves to Friday 30");
  assert.equal(nextPaymentCycleDate(lima("2026-10-31")), "2026-11-13", "Sunday 15 November moves to Friday 13");
  assert.equal(nextPaymentCycleDate(lima("2027-02-20")), "2027-02-26", "Sunday 28 February moves to Friday 26");
  assert.equal(isPaymentCycleDate(lima("2027-02-26")), true);
  assert.equal(isPaymentCycleDate(lima("2027-02-28")), false);
  assert.equal(isPaymentCycleDate(lima("2026-09-29")), false);
  assert.deepEqual(paymentCycleDatesFrom(lima("2026-10-27"), 5), ["2026-10-30", "2026-11-13", "2026-11-30", "2026-12-15", "2026-12-31"]);
  assert.equal(nextUrgencyPaymentDate(lima("2026-10-27")), "2026-10-28", "the weekly urgency window is the next Wednesday");
  assert.equal(nextUrgencyPaymentDate(lima("2026-10-28")), "2026-11-04", "not the same Wednesday");
  assert.equal(isUrgencyPaymentDate(lima("2026-10-28")), true);

  // The payment day a request is offered (ventanaSug): from Tuesday 27 October 2026.
  const now = lima("2026-10-27");
  assert.equal(suggestedPaymentDate({ priority: "P1", now }), "2026-10-27", "P1 Crítica: today");
  assert.equal(suggestedPaymentDate({ priority: "P2", now }), "2026-10-28", "P2 Urgente: next Wednesday");
  assert.equal(suggestedPaymentDate({ priority: "P3", now }), "2026-10-30", "P3 Normal: 3 working days to the 30th");
  assert.equal(suggestedPaymentDate({ priority: "P3", now: lima("2026-10-28") }), "2026-11-13", "under 3 working days: the next one");
  assert.equal(suggestedPaymentDate({ priority: "P4", now, dueDate: "2026-12-20" }), "2026-12-15", "P4: the last payment day before the due date");
  assert.equal(suggestedPaymentDate({ priority: "P3", now, dueDate: "2026-11-01" }), "2026-10-30", "a due date before the next window keeps the next window");
  assert.equal(nextPaymentCycleDate(lima("2026-10-16")), "2026-10-30", "Saturday 31st is moved to Friday 30th");
  assert.equal(nextPaymentCycleDate(lima("2026-12-16")), "2026-12-31", "Thursday last day remains month end");
  assert.equal(lastWorkingDayOfMonth(2026, 10), "2026-10-30");
});
