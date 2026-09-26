import assert from "node:assert/strict";
import test from "node:test";
import { addBusinessDays, businessDaysBetween, isBusinessDay, isPaymentCycleDate, limaDateKey, nextBusinessDay, nextPaymentCycleDate, peruHolidays } from "../../shared/businessCalendar.mjs";

const lima = (date, time = "09:00") => new Date(`${date}T${time}:00-05:00`);

test("business calendar: Peruvian holidays, weekends, Lima time and the 15th/30th payment cycle", () => {
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

  assert.equal(nextPaymentCycleDate(lima("2026-09-03")), "2026-09-15");
  assert.equal(nextPaymentCycleDate(lima("2026-09-16")), "2026-09-30");
  assert.equal(nextPaymentCycleDate(lima("2026-10-31")), "2026-11-15", "31st rolls to the next month's 15th");
  assert.equal(nextPaymentCycleDate(lima("2027-02-20")), "2027-02-28", "February runs on its last day");
  assert.equal(isPaymentCycleDate(lima("2027-02-28")), true);
  assert.equal(isPaymentCycleDate(lima("2026-09-29")), false);
});
