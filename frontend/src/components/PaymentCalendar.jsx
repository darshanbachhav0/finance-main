import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { fetchAllPages } from "../utils/experience.js";
import { formatCurrency } from "../utils/formatters.js";
import Drawer from "./Drawer.jsx";
import { Freshness } from "./ExperienceIndicators.jsx";

const dateKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export default function PaymentCalendar() {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const [at, setAt] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  const [anchor, setAnchor] = useState(dateKey(new Date()));
  const [mode, setMode] = useState("month");
  const [selected, setSelected] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true); setError(""); setRows([]);
    Promise.all([fetchAllPages(api, "/treasury/queue", {}, controller.signal), fetchAllPages(api, "/treasury/payment-confirmations", {}, controller.signal)]).then(([queue, confirmations]) => {
      if (controller.signal.aborted) return;
      const unique = new Map();
      for (const row of [...queue, ...confirmations]) {
        const payable = row.accountsPayable || row;
        const id = payable._id;
        if (!id) continue;
        unique.set(String(id), { id, requestId: row.requestId || row.request?._id || payable.request?._id, reference: row.requestNumber || row.request?.requestNumber || payable.request?.requestNumber, amount: payable.outstandingAmount, currency: payable.currency, date: (payable.scheduledFor || payable.paymentBatch?.paymentDate || payable.dueDate || "").slice(0, 10), scheduled: Boolean(payable.scheduledFor || payable.paymentBatch?.paymentDate) });
      }
      setRows([...unique.values()]); setAt(new Date().toISOString());
    }).catch(err => { if (!controller.signal.aborted) setError(err.message); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [open, reload]);
  const days = useMemo(() => {
    const date = new Date(`${anchor}T12:00:00`);
    if (mode === "month") date.setDate(1); else date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    const count = mode === "week" ? 7 : new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    return Array.from({ length: count }, (_, index) => { const next = new Date(date); next.setDate(date.getDate() + index); return dateKey(next); });
  }, [anchor, mode]);
  const visible = rows.filter(row => selected ? row.date === selected : days.includes(row.date));
  function move(direction) { const date = new Date(`${anchor}T12:00:00`); if (mode === "month") { date.setDate(1); date.setMonth(date.getMonth() + direction); } else date.setDate(date.getDate() + 7 * direction); setAnchor(dateKey(date)); setSelected(""); }
  return <><button className="secondary-button" type="button" onClick={() => setOpen(true)}>{t("Payment calendar")}</button><Drawer size="large" open={open} onClose={() => setOpen(false)} title="Payment calendar"><div className="experience-toolbar"><button type="button" onClick={() => move(-1)}>{t("Previous")}</button><label>{t("Date")}<input type="date" value={anchor} onChange={event => { if (event.target.value) setAnchor(event.target.value); setSelected(""); }} /></label><button type="button" onClick={() => move(1)}>{t("Next")}</button><select aria-label={t("Calendar view")} value={mode} onChange={event => { setMode(event.target.value); setSelected(""); }}><option value="month">{t("Month")}</option><option value="week">{t("Week")}</option></select><button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>{t("Refresh")}</button><Freshness at={at} /></div><p>{t("Scheduled payments use the scheduled date. Unscheduled payments use the due date. Currencies are never combined.")}</p>{error && <p role="alert">{error}</p>}{loading ? <p role="status">{t("Loading all payment pages...")}</p> : !error && <><div className="payment-calendar">{days.map((day, index) => {
    const items = rows.filter(row => row.date === day);
    const totals = items.reduce((map, row) => ({ ...map, [row.currency]: (map[row.currency] || 0) + Number(row.amount || 0) }), {});
    return <button type="button" key={day} style={index === 0 ? { gridColumnStart: (new Date(`${day}T12:00:00`).getDay() + 6) % 7 + 1 } : undefined} aria-pressed={selected === day} onClick={() => setSelected(value => value === day ? "" : day)}><time dateTime={day}>{new Date(`${day}T12:00:00`).toLocaleDateString(language === "es" ? "es-PE" : "en-US", { day: "numeric", weekday: "short" })}</time><small>{items.length} {t("Payments")}</small>{Object.entries(totals).map(([currency, total]) => <strong key={currency}>{formatCurrency(total, currency, language)}</strong>)}</button>;
  })}</div><div className="calendar-records">{visible.map(row => <article key={row.id}><strong>{row.requestId ? <Link to={`/requests/${row.requestId}`} onClick={() => setOpen(false)}>{row.reference || t("Open request")}</Link> : row.reference || t("Payment")}</strong><span>{row.date} · {t(row.scheduled ? "Scheduled" : "Due date")}</span><b>{formatCurrency(row.amount, row.currency, language)}</b></article>)}{!visible.length && <p>{t("No payments on these dates.")}</p>}</div>{rows.some(row => !row.date) && <p>{rows.filter(row => !row.date).length} · {t("Payments without dates remain in the payment queue.")}</p>}</>}</Drawer></>;
}
