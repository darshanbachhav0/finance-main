import { HandCoins, X } from "lucide-react";
import { useState } from "react";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { useLanguage } from "../context/LanguageContext.jsx";
import { paymentDayState } from "../utils/paymentCycle.js";

const STORAGE_KEY = "uma_payment_banner_dismissed";

function dismissedToday(today) {
  try { return localStorage.getItem(STORAGE_KEY) === today; } catch { return false; }
}

// Payment days (15th and 30th) get a small banner; Treasury also gets one the day before, to
// prepare the BBVA file. Closing it hides it until the next day.
export default function PaymentDayBanner({ role }) {
  const { t } = useLanguage();
  const today = limaDateKey(new Date());
  const [hidden, setHidden] = useState(() => dismissedToday(today));
  const state = paymentDayState();
  const treasury = role === "Treasury";
  if (hidden || !state || (state === "tomorrow" && !treasury)) return null;

  const message = state === "tomorrow"
    ? "Payment day is tomorrow: prepare and verify the BBVA file."
    : treasury ? "Today is payment day: today's scheduled payments go out in the BBVA file." : "Today is payment day: scheduled payments are sent to their bank accounts today.";

  function close() {
    setHidden(true);
    try { localStorage.setItem(STORAGE_KEY, today); } catch { /* Hidden for this visit only. */ }
  }

  return (
    <div className="inline-alert payment-day-banner" role="status">
      <HandCoins size={18} aria-hidden="true" />
      <div><strong>{t(state === "tomorrow" ? "Payment day tomorrow" : "Payment day")}</strong><span>{t(message)}</span></div>
      <button type="button" className="icon-button quiet" onClick={close} aria-label={t("Hide until tomorrow")} title={t("Hide until tomorrow")}><X size={16} /></button>
    </div>
  );
}
