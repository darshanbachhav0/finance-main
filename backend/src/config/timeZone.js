// The platform runs on Lima time (UTC-5, no daylight saving) whatever the host's zone: Render runs
// in UTC, development machines in Peru do not. Imported first, so every local-time date operation
// and log line on the server matches the time users see. Business rules still compute Lima dates
// explicitly (shared/businessCalendar.mjs).
process.env.TZ = "America/Lima";
