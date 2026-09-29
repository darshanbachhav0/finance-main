import DateInput from "./DateInput.jsx";
import { HandCoins, Landmark } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import DataTable from "./DataTable.jsx";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import StatusBadge from "./StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";

// Supplier credits (receivables) created by credit notes on already-paid invoices. Accounting
// applies them to a future unpaid invoice of the same supplier or records the supplier's refund.
export default function SupplierCreditsPanel({ table, onChanged }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const [action, setAction] = useState(null);
  const [form, setForm] = useState({});
  const [payables, setPayables] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  async function open(kind, credit) {
    setError("");
    setAction({ kind, credit });
    setForm({ amount: String(credit.remainingAmount), accountsPayableId: "", bank: "", reference: "", date: new Date().toISOString().slice(0, 10) });
    if (kind === "apply") {
      try {
        const response = await api.get("/accounting/accounts-payable", { params: { supplier: credit.supplier?._id || credit.supplier, currency: credit.currency, pageSize: 100 } });
        setPayables((response.data.data || []).filter((row) => ["OPEN", "SCHEDULED", "PARTIALLY_PAID", "PAYMENT_BOUNCED"].includes(row.status) && row.outstandingAmount > 0));
      } catch (err) { setError(err.message); }
    }
  }

  async function submit(event) {
    event.preventDefault();
    setProcessing(true);
    setError("");
    try {
      if (action.kind === "apply") {
        await api.post(`/accounting/supplier-credits/${action.credit._id}/apply`, { accountsPayableId: form.accountsPayableId, amount: Number(form.amount) });
        notify("Supplier credit applied to the invoice.");
      } else {
        await api.post(`/accounting/supplier-credits/${action.credit._id}/recover`, { amount: Number(form.amount), bank: form.bank, date: form.date, reference: form.reference });
        notify("Supplier refund recorded.");
      }
      setAction(null);
      table.reload();
      onChanged?.();
    } catch (err) { setError(err.message); notify(err.message, "error"); }
    finally { setProcessing(false); }
  }

  const money = (currency, value) => formatCurrency(value || 0, currency || "PEN", language);

  return (
    <div className="workspace-panel section-spacer">
      <div className="section-heading"><div><h3>{t("Supplier credits")}</h3><p>{t("Credit notes received after an invoice was paid. Recover the money from the supplier or apply it to a future invoice from the same supplier.")}</p></div><span className="section-count">{table.pagination.total}</span></div>
      <DataTable rows={table.rows} loading={table.loading} remote={table.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["OPEN", "PARTIALLY_APPLIED", "SETTLED"] }]} rowActions={(row) => row.status === "SETTLED" ? [] : [
        { label: "Apply to an invoice", icon: HandCoins, onClick: () => open("apply", row) },
        { label: "Record supplier refund", icon: Landmark, onClick: () => open("recover", row) }
      ]} columns={[
        { key: "creditNoteSeriesNumber", label: "Credit note" },
        { key: "supplier", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || "-" },
        { key: "originalVoucher", label: "Original invoice", sortable: false, render: (row) => row.originalVoucher?.seriesNumber || "-" },
        { key: "amount", label: "Amount", align: "right", render: (row) => money(row.currency, row.amount) },
        { key: "remainingAmount", label: "Remaining", align: "right", render: (row) => <strong>{money(row.currency, row.remainingAmount)}</strong> },
        { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
        { key: "createdAt", label: "Created", render: (row) => formatDateTime(row.createdAt) }
      ]} />
      <Drawer open={Boolean(action)} title={action?.kind === "apply" ? "Apply supplier credit" : "Record supplier refund"} description={action ? `${action.credit.creditNoteSeriesNumber} · ${money(action.credit.currency, action.credit.remainingAmount)}` : ""} onClose={() => !processing && setAction(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setAction(null)}>{t("Cancel")}</button><button type="submit" form="supplier-credit-form" className="primary-button" disabled={processing || (action?.kind === "apply" ? !form.accountsPayableId : !form.bank || !form.reference)}><span>{t(processing ? "Processing..." : "Confirm")}</span></button></>}>
        {action && (
          <form id="supplier-credit-form" className="form-grid" onSubmit={submit}>
            <Message type="error">{error}</Message>
            <label className="field"><span>{t("Amount")} *</span><input type="number" min="0.01" step="0.01" max={action.credit.remainingAmount} required value={form.amount} onChange={(event) => setForm({ ...form, amount: event.target.value })} /></label>
            {action.kind === "apply" ? (
              <label className="field"><span>{t("Unpaid invoice of the same supplier")} *</span>
                <select required value={form.accountsPayableId} onChange={(event) => setForm({ ...form, accountsPayableId: event.target.value })}>
                  <option value="">{t("Select an invoice")}</option>
                  {payables.map((row) => <option key={row._id} value={row._id}>{`${row.voucher?.series || ""}-${row.voucher?.number || ""} · ${row.request?.requestNumber || ""} · ${money(row.currency, row.outstandingAmount)}`}</option>)}
                </select>
                {!payables.length && <small className="field-hint">{t("There is no unpaid invoice of this supplier in the same currency.")}</small>}
              </label>
            ) : (
              <>
                <label className="field"><span>{t("Receiving bank")} *</span><input required value={form.bank} onChange={(event) => setForm({ ...form, bank: event.target.value.toUpperCase() })} placeholder="BCP" /></label>
                <label className="field"><span>{t("Refund date")} *</span><DateInput required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
                <label className="field"><span>{t("Bank operation reference")} *</span><input required value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} /></label>
              </>
            )}
          </form>
        )}
      </Drawer>
    </div>
  );
}
