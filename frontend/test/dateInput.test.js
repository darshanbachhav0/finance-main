import assert from "node:assert/strict";
import {
  addMonths, calendarWeeks, completeDateText, completeMonthText, dateMessage, datePlaceholder, formatIsoDate, formatIsoMonth,
  longDateLabel, maskDateText, maskMonthText, monthYearLabel, parseDisplayDate, parseDisplayMonth, rangeError, todayIso,
  toIsoDate, toIsoMonth, WEEKDAY_SHORT
} from "../src/utils/dateInput.js";

// dd/mm/aaaa <-> ISO, whatever the browser locale.
assert.equal(formatIsoDate("2026-09-30"), "30/09/2026");
assert.equal(formatIsoDate("2026-09-30T05:00:00.000Z"), "30/09/2026");
assert.equal(formatIsoDate(""), "");
assert.equal(formatIsoDate("2026-02-30"), "", "impossible ISO dates are not shown");
assert.deepEqual(parseDisplayDate("30/09/2026"), { iso: "2026-09-30", error: "" });
assert.deepEqual(parseDisplayDate("01/01/2027"), { iso: "2027-01-01", error: "" });
assert.equal(parseDisplayDate(formatIsoDate("2026-12-31")).iso, "2026-12-31", "round trip");
assert.deepEqual(parseDisplayDate(""), { iso: "", error: "" });
assert.equal(toIsoDate(new Date(Date.UTC(2026, 8, 30))), "2026-09-30");

// Invalid and incomplete dates.
assert.equal(parseDisplayDate("31/02/2026").error, "invalid");
assert.equal(parseDisplayDate("29/02/2026").error, "invalid", "2026 is not a leap year");
assert.equal(parseDisplayDate("29/02/2028").iso, "2028-02-29");
assert.equal(parseDisplayDate("00/09/2026").error, "invalid");
assert.equal(parseDisplayDate("12/13/2026").error, "invalid", "month-first input is rejected, not swapped");
assert.equal(parseDisplayDate("30/09").error, "incomplete");
assert.equal(parseDisplayDate("hoy").error, "invalid");
assert.equal(toIsoDate("2026-13-01"), "");

// Typing with automatic slashes, zero padding, deletion and pasted ISO values.
assert.equal(maskDateText("3"), "3");
assert.equal(maskDateText("30"), "30/");
assert.equal(maskDateText("3009"), "30/09/");
assert.equal(maskDateText("30092026"), "30/09/2026");
assert.equal(maskDateText("300920261"), "30/09/2026", "extra digits are ignored");
assert.equal(maskDateText("1/"), "01/");
assert.equal(maskDateText("01/9/"), "01/09/");
assert.equal(maskDateText("30/09", "30/09/"), "30/09", "backspace removes the automatic slash");
assert.equal(maskDateText("30/09/", "30/09/2"), "30/09/");
assert.equal(maskDateText("2026-09-30"), "30/09/2026");
assert.equal(completeDateText("30/09/26"), "30/09/2026", "two-digit years are completed on blur");

// min / max.
assert.equal(rangeError("2026-09-29", "2026-09-30", ""), "min");
assert.equal(rangeError("2026-10-01", "", "2026-09-30"), "max");
assert.equal(rangeError("2026-09-30", "2026-09-30", "2026-09-30"), "");
assert.equal(rangeError("", "2026-09-30", ""), "");
assert.deepEqual(dateMessage("min", { min: "2026-09-30" }), { key: "The date must be {date} or later.", date: "30/09/2026" });
assert.deepEqual(dateMessage("max", { kind: "month", max: "2026-09" }), { key: "The month must be {date} or earlier.", date: "09/2026" });
assert.equal(dateMessage("invalid"), "Enter a valid date (dd/mm/yyyy).");
assert.equal(dateMessage(""), "");

// Months: mm/aaaa <-> "YYYY-MM".
assert.equal(formatIsoMonth("2026-09"), "09/2026");
assert.equal(formatIsoMonth("2026-09-30"), "09/2026");
assert.deepEqual(parseDisplayMonth("09/2026"), { iso: "2026-09", error: "" });
assert.equal(parseDisplayMonth("13/2026").error, "invalid");
assert.equal(parseDisplayMonth("09/20").error, "incomplete");
assert.equal(completeMonthText("09/26"), "09/2026");
assert.equal(maskMonthText("9/"), "09/");
assert.equal(maskMonthText("092026"), "09/2026");
assert.equal(maskMonthText("2026-09"), "09/2026");
assert.equal(toIsoMonth("2026-00"), "");
assert.equal(rangeError("2026-08", "2026-09", ""), "min");

// Placeholders and calendar: Spanish names, Monday-first weeks.
assert.equal(datePlaceholder("es"), "dd/mm/aaaa");
assert.equal(datePlaceholder("en"), "dd/mm/yyyy");
assert.equal(datePlaceholder("es", "month"), "mm/aaaa");
assert.equal(WEEKDAY_SHORT.es[0], "lu");
assert.equal(monthYearLabel(2026, 9, "es"), "Septiembre 2026");
assert.equal(longDateLabel("2026-09-30", "es"), "miércoles, 30 de septiembre de 2026");
const weeks = calendarWeeks(2026, 9);
assert.ok(weeks.every((week) => week.length === 7));
assert.equal(weeks[0][0].iso, "2026-08-31", "September 2026 starts on Tuesday, the grid starts on Monday 31/08");
assert.equal(weeks[0][1].iso, "2026-09-01");
assert.equal(weeks.at(-1).at(-1).iso, "2026-10-04");
assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
assert.equal(todayIso(new Date(2026, 8, 29, 23, 30)), "2026-09-29", "today uses the local day, not UTC");

console.log("PASS DateInput: dd/mm/aaaa and mm/aaaa to ISO and back, invalid dates, typing mask, min/max, Monday-first Spanish calendar");
