import { Eye, Plus, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import api from "../../api/client.js";
import ConfirmDialog from "../ConfirmDialog.jsx";
import DateInput from "../DateInput.jsx";
import Message from "../Message.jsx";
import ProtectedAssetButton from "../ProtectedAssetButton.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { canonicalRequestStatus } from "../../../../shared/workflowStatus.mjs";
import { celebrate } from "../../utils/celebrate.js";
import { todayIso } from "../../utils/dateInput.js";
import { formatCurrency, formatDate } from "../../utils/formatters.js";
import { RECEIPT_LABELS, RECEIPT_TYPES, emptyRow, renditionPayload, renditionTotals, rowProblems, rowsFromRendition, transportDaysOverLimit } from "../../utils/simpleRendition.js";

const KIND_LABELS = { RECEIPT: "Receipt (factura, boleta, ticket)", TRANSPORT: "Transport without receipt", NO_RECEIPT: "Expense without receipt" };
const readable = (file) => /\.(xml|pdf)$/i.test(file?.name || "");

// The employee's rendition of an advance, in plain steps: list what was spent (one row per
// receipt, transport trip or expense without receipt), the money returned, and send it.
// Accounting's review keeps the full detail (OfficialRenditionWorkspace).
export default function SimpleRenditionForm({ request, onReload }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const rendition = request.rendition || {};
  const currency = request.currency || "PEN";
  const editable = ["PENDING", "OBSERVED"].includes(rendition.status)
    && ["PAGADO", "CONCILIADO"].includes(canonicalRequestStatus(request.status))
    && rendition.financeReview?.result !== "REJECTED";
  const advanced = Number(rendition.amountAdvanced || request.payment?.confirmedAmount || request.totalAmount || 0);
  const savedRows = useMemo(() => rowsFromRendition(rendition), [request._id, request.updatedAt]);
  const [rows, setRows] = useState(() => (savedRows.length ? savedRows : [emptyRow("RECEIPT", todayIso())]));
  const [returned, setReturned] = useState(() => (rendition.amountReturned ? String(rendition.amountReturned) : ""));
  const [slip, setSlip] = useState(null);
  const [comments, setComments] = useState("");
  const [limit, setLimit] = useState(null);
  const [reading, setReading] = useState("");
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!editable) return;
    api.get(`/requests/${request._id}/rendition/policy`).then((response) => setLimit(response.data.data?.mobility?.numericValue ?? null)).catch(() => setLimit(null));
  }, [request._id, editable]);

  const attachments = request.attachments || [];
  const attachmentOf = (id) => attachments.find((item) => String(item._id) === String(id));
  const totals = renditionTotals({ rows, advanced, returned });
  const costCenter = request.lines?.[0]?.costCenter?._id || request.lines?.[0]?.costCenter || request.requesterCostCenter?._id || request.requesterCostCenter;
  const hasNoReceipt = rows.some((row) => row.kind === "NO_RECEIPT");
  const overLimitDays = transportDaysOverLimit(rows, limit);
  const money = (value) => formatCurrency(value, currency, language);

  const problems = [];
  if (!rows.length) problems.push(t("Add at least one expense."));
  rows.forEach((row, index) => {
    const missing = rowProblems(row);
    if (missing.length) problems.push(`${t("Expense {number}").replace("{number}", index + 1)}: ${t("add")} ${missing.map((item) => t(item)).join(", ")}.`);
  });
  if (totals.balance > 0) problems.push(t("{amount} of the advance is not accounted for yet: add expenses, or the money you returned.").replace("{amount}", money(totals.balance)));
  if (totals.balance < 0) problems.push(t("Your expenses and the money returned add up to {amount} more than the advance.").replace("{amount}", money(-totals.balance)));
  if (totals.returned > 0 && !slip && !rendition.returnDepositSlip) problems.push(t("Attach the deposit slip for the money you returned."));
  const evidence = rows.some((row) => row.file || row.attachment) || attachments.some((item) => item.kind === "RENDITION");
  if (rows.length && !evidence) problems.push(t("Attach at least one photo or PDF (a receipt, or the transport sheet)."));

  const updateRow = (index, patch) => setRows((current) => current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row)));

  // A factura XML or PDF fills in its date, number, RUC and amount; a photo is kept as it is.
  async function attachFile(index, file) {
    updateRow(index, { file, attachment: file ? null : rows[index].attachment });
    if (!file || rows[index].kind !== "RECEIPT" || !readable(file)) return;
    const row = rows[index];
    setReading(row.clientId);
    try {
      const data = new FormData();
      data.append(/\.xml$/i.test(file.name) ? "xml" : "pdf", file);
      const { invoice, supplier } = (await api.post("/requests/invoice-preview", data, { headers: { "Content-Type": "multipart/form-data" } })).data.data || {};
      if (invoice) {
        updateRow(index, {
          documentType: "FACTURA",
          date: invoice.issueDate ? String(invoice.issueDate).slice(0, 10) : row.date,
          documentNumber: invoice.invoiceNumber || [invoice.series, invoice.number].filter(Boolean).join("-") || row.documentNumber,
          issuerRuc: invoice.ruc || row.issuerRuc,
          amount: invoice.totalAmount ? String(invoice.totalAmount) : row.amount,
          description: row.description || supplier?.legalName || supplier?.name || ""
        });
        notify("Read from the factura. Check the date and the amount.", "info");
      }
    } catch {
      // Not a readable factura (e.g. a scanned boleta): the employee types the details.
    } finally {
      setReading("");
    }
  }

  async function send() {
    setProcessing(true);
    setError("");
    const payload = renditionPayload({ rows, returned, costCenter, purpose: request.title || request.description || "" });
    const data = new FormData();
    payload.files.forEach((file) => data.append("rendition", file));
    if (slip) data.append("returnReceipt", slip);
    data.append("receiptLines", JSON.stringify(payload.receiptLines));
    data.append("mobilityLines", JSON.stringify(payload.mobilityLines));
    data.append("unsupportedExpenseLines", JSON.stringify(payload.unsupportedExpenseLines));
    data.append("lines", JSON.stringify(payload.lines));
    data.append("amountReturned", String(payload.amountReturned));
    data.append("confirmedExceptionalUse", String(hasNoReceipt));
    data.append("beneficiaryAcknowledged", "true");
    data.append("comments", comments);
    try {
      await api.post(`/requests/${request._id}/rendition`, data, { headers: { "Content-Type": "multipart/form-data" } });
      setConfirmOpen(false);
      notify("Rendition sent. Accounting will review it.");
      celebrate("Rendition sent");
      await onReload();
    } catch (err) {
      setError(err.message);
      setConfirmOpen(false);
    } finally {
      setProcessing(false);
    }
  }

  const fileCell = (row, index) => {
    const saved = row.attachment && !row.file ? attachmentOf(row.attachment) : null;
    return <div className="simple-rendition-file">
      <label className="field"><span>{t(row.kind === "RECEIPT" ? "Photo or PDF of the receipt" : "Photo or PDF (optional)")}{row.kind === "RECEIPT" ? " *" : ""}</span>
        <input type="file" accept="image/*,.pdf,.xml" onChange={(event) => attachFile(index, event.target.files?.[0] || null)} /></label>
      {reading === row.clientId && <small>{t("Reading the factura...")}</small>}
      {saved && <small>{t("Already attached")}: {saved.originalName}</small>}
    </div>;
  };

  if (!editable) {
    return <div className="workspace-panel simple-rendition">
      <div className="section-heading"><div><h3>{t("Your receipts")}</h3><p>{t(rendition.status === "SUBMITTED" ? "Sent to Accounting. You will be notified when they review it." : rendition.status === "VALIDATED" ? "Accounting validated your rendition." : "The receipts you presented.")}</p></div></div>
      {savedRows.length ? <ul className="simple-rendition-list">{savedRows.map((row, index) => {
        const file = row.attachment ? attachmentOf(row.attachment) : null;
        return <li key={row.clientId || index}>
          <span>{row.date ? formatDate(`${row.date}T12:00:00Z`, language) : "-"}</span>
          <strong>{row.kind === "TRANSPORT" ? `${row.origin} → ${row.destination}` : row.description}</strong>
          <small>{t(row.kind === "RECEIPT" ? RECEIPT_LABELS[row.documentType] || "Receipt" : KIND_LABELS[row.kind])}{row.documentNumber ? ` · ${row.documentNumber}` : ""}</small>
          <b>{money(row.amount)}</b>
          {file?.url && <ProtectedAssetButton className="icon-button" resourcePath={file.url} fileName={file.originalName} preview title="View document" ariaLabel={`${t("View document")}: ${file.originalName}`}><Eye size={16} aria-hidden="true" /></ProtectedAssetButton>}
        </li>;
      })}</ul> : <p className="section-note">{t("No receipts presented yet.")}</p>}
      <dl className="simple-rendition-totals"><div><dt>{t("Advance")}</dt><dd>{money(advanced)}</dd></div><div><dt>{t("Spent")}</dt><dd>{money(rendition.amountRendered || 0)}</dd></div><div><dt>{t("Returned")}</dt><dd>{money(rendition.amountReturned || 0)}</dd></div></dl>
    </div>;
  }

  return <div className="workspace-panel simple-rendition">
    <div className="section-heading"><div><h3>{t("Your receipts")}</h3><p>{t("Add each thing you paid with the advance. A photo from your phone is fine.")}</p></div></div>
    <Message type="error">{error}</Message>
    <fieldset disabled={processing} className="simple-rendition-fields">
      <ol className="simple-rendition-rows">
        {rows.map((row, index) => <li key={row.clientId} className="simple-rendition-row">
          <div className="simple-rendition-row-head">
            <strong>{t("Expense {number}").replace("{number}", index + 1)}</strong>
            <label className="field"><span className="sr-only">{t("Type of expense")}</span>
              <select value={row.kind} onChange={(event) => updateRow(index, { kind: event.target.value, documentType: event.target.value === "RECEIPT" ? row.documentType || "BOLETA" : "" })}>
                {Object.entries(KIND_LABELS).map(([kind, label]) => <option key={kind} value={kind}>{t(label)}</option>)}
              </select></label>
            <button type="button" className="icon-button danger-icon" onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} aria-label={`${t("Remove expense")} ${index + 1}`} title={t("Remove expense")}><Trash2 size={16} /></button>
          </div>
          <div className="simple-rendition-row-fields">
            <label className="field"><span>{t("Date")} *</span><DateInput value={row.date} max={todayIso()} onChange={(event) => updateRow(index, { date: event.target.value })} /></label>
            {row.kind === "RECEIPT" && <label className="field"><span>{t("Receipt type")}</span><select value={row.documentType} onChange={(event) => updateRow(index, { documentType: event.target.value })}>{RECEIPT_TYPES.map((type) => <option key={type} value={type}>{t(RECEIPT_LABELS[type])}</option>)}</select></label>}
            {row.kind === "TRANSPORT" ? <>
              <label className="field"><span>{t("From")} *</span><input value={row.origin} onChange={(event) => updateRow(index, { origin: event.target.value })} /></label>
              <label className="field"><span>{t("To")} *</span><input value={row.destination} onChange={(event) => updateRow(index, { destination: event.target.value })} /></label>
            </> : <label className="field simple-rendition-wide"><span>{t("What it was for")} *</span><input value={row.description} onChange={(event) => updateRow(index, { description: event.target.value })} /></label>}
            <label className="field"><span>{t("Amount")} ({currency}) *</span><input type="number" inputMode="decimal" min="0.01" step="0.01" value={row.amount} onChange={(event) => updateRow(index, { amount: event.target.value })} /></label>
            {row.kind === "RECEIPT" && <label className="field"><span>{t("Receipt number (optional)")}</span><input value={row.documentNumber} onChange={(event) => updateRow(index, { documentNumber: event.target.value })} /></label>}
            {row.kind === "RECEIPT" && row.documentType === "FACTURA" && <label className="field"><span>{t("RUC of the business (optional)")}</span><input inputMode="numeric" value={row.issuerRuc} onChange={(event) => updateRow(index, { issuerRuc: event.target.value })} /></label>}
          </div>
          {fileCell(row, index)}
          {row.kind === "NO_RECEIPT" && <p className="section-note">{t("Only when the business gave no receipt. You confirm it when you send the rendition.")}</p>}
        </li>)}
      </ol>
      <button type="button" className="secondary-button" onClick={() => setRows((current) => [...current, emptyRow("RECEIPT", todayIso())])}><Plus size={16} /><span>{t("Add an expense")}</span></button>
      {overLimitDays.length > 0 && <p className="inline-alert alert-warning">{t("Transport on {days} is above the daily limit of {limit}. You can still send it; Accounting decides.").replace("{days}", overLimitDays.map((day) => formatDate(`${day}T12:00:00Z`, language)).join(", ")).replace("{limit}", money(limit))}</p>}

      <section className="simple-rendition-return">
        <h4>{t("Money you returned")}</h4>
        {request.advanceReturnAccount && <p>{t("Deposit what you did not spend to: {account}.").replace("{account}", request.advanceReturnAccount)}</p>}
        <div className="simple-rendition-row-fields">
          <label className="field"><span>{t("Amount returned")} ({currency})</span><input type="number" inputMode="decimal" min="0" step="0.01" value={returned} onChange={(event) => setReturned(event.target.value)} placeholder="0.00" /></label>
          {totals.returned > 0 && <label className="field"><span>{t("Deposit slip")} *</span><input type="file" accept="image/*,.pdf" onChange={(event) => setSlip(event.target.files?.[0] || null)} /></label>}
        </div>
      </section>

      <dl className="simple-rendition-totals">
        <div><dt>{t("Advance")}</dt><dd>{money(totals.advanced)}</dd></div>
        <div><dt>{t("Spent")}</dt><dd>{money(totals.spent)}</dd></div>
        <div><dt>{t("Returned")}</dt><dd>{money(totals.returned)}</dd></div>
        <div className={totals.balance === 0 ? "is-balanced" : "is-open"}><dt>{t("Left to account for")}</dt><dd>{money(totals.balance)}</dd></div>
      </dl>
      {problems.length > 0 && <ul className="simple-rendition-problems" aria-live="polite">{problems.map((problem) => <li key={problem}>{problem}</li>)}</ul>}
      <label className="field"><span>{t("Anything Accounting should know? (optional)")}</span><textarea rows="2" value={comments} onChange={(event) => setComments(event.target.value)} /></label>
      <button type="button" className="primary-button" disabled={processing || problems.length > 0} onClick={() => setConfirmOpen(true)}><Send size={16} /><span>{t("Send rendition")}</span></button>
    </fieldset>
    <ConfirmDialog
      open={confirmOpen}
      title="Send your rendition?"
      description={hasNoReceipt ? "I confirm these are my expenses for this advance, and that the ones marked 'without receipt' had no receipt." : "I confirm these are my expenses for this advance."}
      details={[{ label: "Spent", value: money(totals.spent) }, { label: "Returned", value: money(totals.returned) }]}
      confirmLabel="Confirm and send"
      loading={processing}
      onClose={() => !processing && setConfirmOpen(false)}
      onConfirm={send}
    />
  </div>;
}
