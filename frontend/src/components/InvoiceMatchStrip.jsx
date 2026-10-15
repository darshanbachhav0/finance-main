import { CheckCircle2, CircleAlert } from "lucide-react";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency } from "../utils/formatters.js";
import { invoiceMatchRows } from "../utils/invoiceAutofill.js";

// Live comparison of the form with the invoice that was read, before saving: the same currency,
// supplier and to-the-cent amount checks the platform applies to a Track B request.
export default function InvoiceMatchStrip({ invoice, form, totals, supplier, flowType }) {
  const { t, language } = useLanguage();
  const rows = invoiceMatchRows({ invoice, form, totals, supplier });
  if (!rows.length) return null;
  const allMatch = rows.every((row) => row.ok);
  const informative = flowType !== "B";
  const show = (row, value) => (row.money ? formatCurrency(value, form.currency, language) : value || "-");

  return (
    <section className={`invoice-match ${allMatch ? "is-match" : informative ? "is-info" : "is-mismatch"}`} aria-live="polite">
      <header>
        {allMatch ? <CheckCircle2 size={18} aria-hidden="true" /> : <CircleAlert size={18} aria-hidden="true" />}
        <strong>{t(allMatch ? "Everything matches the invoice" : informative ? "Differences with the invoice" : "Fix these differences before saving")}</strong>
        {!allMatch && informative && <span>{t("Track A1 invoices are matched against the purchase order later, so a partial invoice can differ.")}</span>}
      </header>
      <ul>
        {rows.map((row) => (
          <li key={row.key} className={row.ok ? "ok" : "differs"}>
            <span>{t(row.label)}</span>
            {row.ok
              ? <strong>{show(row, row.found)} ✓</strong>
              : <strong>{t("Form {form} · invoice {invoice}").replace("{form}", show(row, row.expected)).replace("{invoice}", show(row, row.found))}</strong>}
          </li>
        ))}
      </ul>
    </section>
  );
}
