import {
  AlertTriangle,
  CircleCheckBig,
  Download,
  Eye,
  FileDown,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Scale,
  Star,
  UploadCloud,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { banks, flowTypes, requestTypes } from "../utils/options.js";

const money = (currency, value) => `${currency || "PEN"} ${Number(value || 0).toLocaleString(undefined, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})}`;
const amountOf = (row) => Number(row.accountsPayable?.outstandingAmount ?? row.outstandingAmount ?? row.totalAmount ?? 0);
const requestIdOf = (row) => row.requestId || row.request?._id || row._id;
const payableIdOf = (row) => row.accountsPayable?._id || row._id;

export default function TreasuryQueue() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [selected, setSelected] = useState([]);
  const [accountSelections, setAccountSelections] = useState({});
  const [bank, setBank] = useState("BCP");
  const [currency, setCurrency] = useState("PEN");
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ operationNumber: "", paidAt: new Date().toISOString().slice(0, 10), confirmedAmount: "", comments: "" });
  const [bounceRow, setBounceRow] = useState(null);
  const [bounceForm, setBounceForm] = useState({ reason: "", bankReference: "" });
  const [reprogramRow, setReprogramRow] = useState(null);
  const [reprogramForm, setReprogramForm] = useState({ comments: "", cciLetter: null });
  const [reconciliationRow, setReconciliationRow] = useState(null);
  const [reconciliationForm, setReconciliationForm] = useState({ bankReference: "", statementAmount: "", comments: "" });

  const queueTable = usePaginatedResource("/treasury/queue", { fixedParams: { bank, currency }, persistKey: "treasury-queue" });
  const historyTable = usePaginatedResource("/treasury/bank-files");
  const confirmationTable = usePaginatedResource("/treasury/payment-confirmations");
  const bouncedTable = usePaginatedResource("/treasury/bounced-payments");
  const reconciliationTable = usePaginatedResource("/treasury/reconciliation");
  const rows = queueTable.rows;
  const loading = queueTable.loading || historyTable.loading || confirmationTable.loading || bouncedTable.loading || reconciliationTable.loading;
  const resourceError = queueTable.error || historyTable.error || confirmationTable.error || bouncedTable.error || reconciliationTable.error;

  function reloadAll() {
    queueTable.reload();
    historyTable.reload();
    confirmationTable.reload();
    bouncedTable.reload();
    reconciliationTable.reload();
  }

  useEffect(() => {
    setSelected((current) => current.filter((id) => rows.some((row) => String(payableIdOf(row)) === String(id))));
  }, [rows]);

  useEffect(() => {
    setAccountSelections((current) => {
      const next = {};
      for (const row of rows) {
        const payableId = payableIdOf(row);
        const accounts = row.eligibleBankAccounts || row.activeBankAccounts || [];
        const locked = row.destinationLocked || row.paymentDestination
          ? row.paymentDestination
          : null;
        const eligible = accounts.filter((account) => account.bank === bank && account.currency === currency);
        const existing = eligible.find((account) => String(account._id) === String(current[payableId]));
        const account = locked || existing || eligible.find((item) => item.preferred) || eligible[0];
        const accountId = account?.bankAccountId || account?.employeeBankAccountId || account?._id;
        if (accountId) next[payableId] = String(accountId);
      }
      return next;
    });
  }, [rows, bank, currency]);

  const matchingAccounts = (row) => {
    if (row.paymentDestination?.sourceType === "EMPLOYEE_REIMBURSEMENT") {
      if (row.paymentDestination.bank === bank && row.paymentDestination.currency === currency) return [row.paymentDestination];
      return [];
    }
    if (row.destinationLocked || row.paymentDestination) {
      if (row.paymentDestination?.bank === bank && row.paymentDestination?.currency === currency) return [row.paymentDestination];
      return [];
    }
    return (row.eligibleBankAccounts || row.activeBankAccounts || []).filter((account) => account.bank === bank && account.currency === currency);
  };
  const destinationBank = (row) => {
    if (row.paymentDestination) return row.paymentDestination.bank;
    return "";
  };
  const selectedRows = rows.filter((row) => selected.includes(String(payableIdOf(row))));
  const selectedTotal = useMemo(() => selectedRows.reduce((sum, row) => sum + amountOf(row), 0), [selectedRows]);
  const queueTotals = useMemo(() => Object.fromEntries(Object.entries(queueTable.payload.summary?.totalsByCurrency || {}).map(([key, value]) => [key, Number(value.total || 0)])), [queueTable.payload.summary]);
  const missingBank = Number(queueTable.payload.summary?.missingBankDetails || 0);

  const toggleRow = (row) => {
    const id = String(payableIdOf(row));
    if (!matchingAccounts(row).length) return;
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  async function generate() {
    setProcessing(true);
    try {
      const selectedAccounts = Object.fromEntries(selected.map((id) => {
        const row = rows.find((item) => String(payableIdOf(item)) === String(id));
        return row?.destinationLocked || row?.paymentDestination?.sourceType === "EMPLOYEE_REIMBURSEMENT"
          ? [id, null]
          : [id, accountSelections[id]];
      }).filter(([, accountId]) => accountId));
      const response = await api.post("/treasury/bank-file", {
        payableIds: selected,
        bank,
        currency,
        paymentDate,
        accountSelections: selectedAccounts
      });
      setResult(response.data);
      setSelected([]);
      setConfirmOpen(false);
      setActionError("");
      notify("Bank TXT instruction created. Payment remains unconfirmed.");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
      setConfirmOpen(false);
    } finally {
      setProcessing(false);
    }
  }

  function openPaymentConfirmation(row) {
    setPaymentRow(row);
    setPaymentForm({
      operationNumber: "",
      paidAt: new Date().toISOString().slice(0, 10),
      confirmedAmount: String(amountOf(row)),
      comments: ""
    });
  }

  async function confirmPayment(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/payables/${payableIdOf(paymentRow)}/confirm-payment`, paymentForm);
      notify("Actual bank payment confirmed; CXP was settled and the payment journal was posted.");
      setPaymentRow(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  async function reportBounce(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/payables/${payableIdOf(bounceRow)}/bounce`, bounceForm);
      notify("The rejected transfer was reopened as PAGO_REBOTADO.");
      setBounceRow(null);
      setBounceForm({ reason: "", bankReference: "" });
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  async function reprogramPayment(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      const data = new FormData();
      data.append("comments", reprogramForm.comments);
      data.append("cciLetter", reprogramForm.cciLetter);
      await api.post(`/treasury/payables/${payableIdOf(reprogramRow)}/reprogram`, data);
      notify("Signed CCI evidence stored. The CXP is available for Treasury scheduling again.");
      setReprogramRow(null);
      setReprogramForm({ comments: "", cciLetter: null });
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  function openReconciliation(row) {
    setReconciliationRow(row);
    setReconciliationForm({ bankReference: row.payment?.operationNumber || "", statementAmount: String(row.payment?.confirmedAmount ?? ""), comments: "" });
  }

  async function reconcile(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/requests/${requestIdOf(reconciliationRow)}/reconcile`, reconciliationForm);
      notify("Payment reconciled. The request is ready for Accounting closure.");
      setReconciliationRow(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  const queueColumns = [
    { key: "select", label: "", sortable: false, render: (row) => <input type="checkbox" aria-label={t("Select CXP")} checked={selected.includes(String(payableIdOf(row)))} disabled={!matchingAccounts(row).length} onChange={() => toggleRow(row)} /> },
    { key: "requestNumber", label: "Request", sortable: false, render: (row) => <button type="button" className="link-button" onClick={() => setQuickViewId(requestIdOf(row))}>{row.requestNumber}</button> },
    { key: "supplier", label: "Supplier", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.supplier?.legalName || row.supplier?.name || row.requester?.name || "UMA collaborator"}</strong><span>{row.accountsPayable?.voucher?.series ? `${row.accountsPayable.voucher.series}-${row.accountsPayable.voucher.number}` : row.accountsPayable?.supplierIdentifierSnapshot || "-"}</span></div> },
    { key: "flowType", label: "Track", getValue: (row) => row.accountsPayable?.flowType || row.flowType, render: (row) => <StatusBadge status={row.accountsPayable?.flowType || row.flowType} /> },
    { key: "priority", label: "Priority", getValue: (row) => row.accountsPayable?.paymentPriority, render: (row) => <StatusBadge status={row.accountsPayable?.paymentPriority || "NORMAL"} /> },
    { key: "account", label: "Payment destination snapshot", sortable: false, render: (row) => {
      const accounts = matchingAccounts(row);
      const payableId = String(payableIdOf(row));
      const locked = row.destinationLocked || row.paymentDestination;
      if (!accounts.length) return <span className="blocked-inline"><AlertTriangle size={14} />{t("No eligible matching account")}</span>;
      if (locked) {
        const account = accounts[0];
        return <div className="payment-destination-summary compact"><LockKeyhole size={14} /><div><strong>{destinationBank(row)} · {account.currency}</strong><span>{account.cciMasked || account.cci || account.accountNumberMasked || account.accountNumber}</span><small>{t("Payment destination snapshot")}</small></div></div>;
      }
      const selectedId = accountSelections[payableId];
      const selectedAccount = accounts.find((account) => String(account._id) === String(selectedId)) || accounts[0];
      return <label className="table-account-select" onClick={(event) => event.stopPropagation()}><span className="sr-only">{t("Treasury Account Selection")}</span><select value={selectedId || ""} onChange={(event) => setAccountSelections((current) => ({ ...current, [payableId]: event.target.value }))}>{accounts.map((account) => <option key={account._id} value={account._id}>{account.preferred ? `${t("Preferred account")} - ` : ""}{account.bank} - {account.cci || account.accountNumber}</option>)}</select><small>{selectedAccount?.preferred ? <><Star size={11} />{t("Preferred account")}</> : t("Only verified eligible current accounts are listed.")}</small></label>;
    } },
    { key: "status", label: "CXP status", getValue: (row) => row.accountsPayable?.status, render: (row) => <StatusBadge status={row.accountsPayable?.status} /> },
    { key: "amount", sortKey: "outstandingAmount", label: "Outstanding", align: "right", getValue: amountOf, render: (row) => <strong>{money(row.currency || row.accountsPayable?.currency, amountOf(row))}</strong> },
    { key: "dueDate", label: "Due date", getValue: (row) => row.accountsPayable?.dueDate, render: (row) => row.accountsPayable?.dueDate ? new Date(row.accountsPayable.dueDate).toLocaleDateString() : "-" }
  ];

  return <section>
    <PageHeader title="Treasury Payment Queue" description="Schedule each CXP independently, create bank instructions, confirm execution, isolate bounced transfers, and reconcile paid requests." actions={<button type="button" className="secondary-button" onClick={reloadAll} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
    <Message type="error">{actionError || resourceError}</Message>
    <div className="stats-grid"><StatCard label="Payable queue" value={queueTable.pagination.total} tone="amber" /><StatCard label="PEN waiting" value={money("PEN", queueTotals.PEN)} tone="teal" /><StatCard label="USD waiting" value={money("USD", queueTotals.USD)} tone="navy" /><StatCard label="Missing bank details" value={missingBank} tone={missingBank ? "red" : "green"} /><StatCard label="Payment confirmation" value={confirmationTable.pagination.total} tone="amber" /><StatCard label="Bounced payments" value={bouncedTable.pagination.total} tone={bouncedTable.pagination.total ? "red" : "green"} /></div>

    {missingBank > 0 && <div className="alert-strip error"><AlertTriangle size={20} /><div><strong>{t("Some payments are blocked")}</strong><p>{t("A payment needs a verified eligible current account, or the immutable employee reimbursement destination, before file generation.")}</p></div></div>}

    <div className="workspace-panel treasury-file-controls"><div className="section-heading"><div><h3>{t("Bank file preparation")}</h3><p>{t("The batch is generated from selected CXP records, not from one request-level payable.")}</p></div></div><div className="filter-row"><label className="field"><span>{t("Bank")}</span><select value={bank} onChange={(event) => { setBank(event.target.value); setSelected([]); }}>{banks.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="field"><span>{t("Currency")}</span><select value={currency} onChange={(event) => { setCurrency(event.target.value); setSelected([]); }}><option value="PEN">PEN</option><option value="USD">USD</option></select></label><label className="field"><span>{t("Payment date")}</span><input type="date" value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /></label></div></div>

    {selected.length > 0 && <div className="selection-bar" role="status"><div><strong>{t("{count} CXP records selected").replace("{count}", selected.length)}</strong><span>{money(currency, selectedTotal)}</span></div><button type="button" className="primary-button" onClick={() => setConfirmOpen(true)}><FileDown size={16} /><span>{t("Review bank file")}</span></button></div>}
    {result && <div className="success-result" role="status"><div><strong>{t("Bank instruction generated")}</strong><span>{result.fileName} · {result.notice}</span></div>{result.url && <ProtectedAssetButton className="secondary-button" resourcePath={result.url} fileName={result.fileName}><Download size={16} />{t("Download")}</ProtectedAssetButton>}</div>}

    <div className="workspace-panel section-spacer"><DataTable rows={rows} loading={queueTable.loading} remote={queueTable.remote} filters={[{ key: "requestType", label: "types", allLabel: "All types", options: requestTypes }, { key: "flowType", label: "tracks", allLabel: "All tracks", options: flowTypes }, { key: "paymentPriority", label: "priorities", allLabel: "All priorities", options: ["NORMAL", "PRIORITY"] }]} searchPlaceholder="Search request, supplier, voucher, or cost center..." rowActions={(row) => [{ label: "Open request", icon: Eye, onClick: () => setQuickViewId(requestIdOf(row)) }]} columns={queueColumns} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Payment confirmation")}</h3><p>{t("Confirm the item or report the bank rejection. A rejected item becomes PAGO_REBOTADO without cancelling other invoices in the same request.")}</p></div><span className="section-count">{confirmationTable.pagination.total}</span></div><DataTable rows={confirmationTable.rows} loading={confirmationTable.loading} remote={confirmationTable.remote} rowActions={(row) => [{ label: "Confirm payment", icon: CircleCheckBig, onClick: () => openPaymentConfirmation(row) }, { label: "Report bounced payment", icon: XCircle, onClick: () => { setBounceRow(row); setBounceForm({ reason: "", bankReference: "" }); } }]} columns={[
      { key: "requestNumber", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || "UMA collaborator" },
      { key: "flowType", label: "Track", render: (row) => <StatusBadge status={row.accountsPayable?.flowType || row.flowType} /> },
      { key: "batch", label: "Bank batch", sortable: false, render: (row) => `${row.accountsPayable?.paymentBatch?.batchNumber || "-"} / ${row.accountsPayable?.paymentBatch?.bank || "-"}` },
      { key: "status", label: "CXP status", render: (row) => <StatusBadge status={row.accountsPayable?.status} /> },
      { key: "amount", label: "Amount", align: "right", getValue: amountOf, render: (row) => <strong>{money(row.currency, amountOf(row))}</strong> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Bounced payment reprogramming")}</h3><p>{t("A signed CCI letter is mandatory before the CXP returns to the payment queue.")}</p></div><span className="section-count">{bouncedTable.pagination.total}</span></div><DataTable rows={bouncedTable.rows} loading={bouncedTable.loading} remote={bouncedTable.remote} rowActions={(row) => [{ label: "Upload CCI letter and reprogram", icon: RotateCcw, onClick: () => { setReprogramRow(row); setReprogramForm({ comments: "", cciLetter: null }); } }]} columns={[
      { key: "requestNumber", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || "UMA collaborator" },
      { key: "reason", label: "Bank rejection", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.accountsPayable?.bouncedPayment?.reason || "-"}</strong><span>{row.accountsPayable?.bouncedPayment?.bankReference || "-"}</span></div> },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.accountsPayable?.status || "PAYMENT_BOUNCED"} /> },
      { key: "amount", label: "Outstanding", align: "right", render: (row) => <strong>{money(row.currency, amountOf(row))}</strong> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Reconciliation")}</h3><p>{t("Match all confirmed CXP payments to the bank statement before Accounting closure.")}</p></div><span className="section-count">{reconciliationTable.pagination.total}</span></div><DataTable rows={reconciliationTable.rows} loading={reconciliationTable.loading} remote={reconciliationTable.remote} rowActions={(row) => [{ label: "Reconcile payment", icon: Scale, onClick: () => openReconciliation(row) }]} columns={[
      { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || "UMA collaborator" },
      { key: "operation", label: "Operation number", render: (row) => row.payment?.operationNumber || "-" },
      { key: "paidAt", label: "Paid date", render: (row) => row.payment?.paidAt ? new Date(row.payment.paidAt).toLocaleDateString() : "-" },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "amount", label: "Confirmed", align: "right", render: (row) => <strong>{money(row.currency, row.payment?.confirmedAmount)}</strong> }
    ]} /></div>

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Generated bank-file history")}</h3><p>{t("Every batch retains its checksum, adapter mode, CXP items, and generation user.")}</p></div></div><DataTable rows={historyTable.rows} loading={historyTable.loading} remote={historyTable.remote} filters={[{ key: "bank", label: "banks", allLabel: "All banks", options: banks }, { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
      { key: "batchNumber", label: "Batch" },
      { key: "fileName", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
      { key: "bank", label: "Bank" },
      { key: "currency", label: "Currency" },
      { key: "items", label: "CXP items", sortable: false, render: (row) => row.items?.length || 0 },
      { key: "totalAmount", label: "Total", align: "right", render: (row) => money(row.currency, row.totalAmount) },
      { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "generatedAt", label: "Generated", render: (row) => new Date(row.generatedAt).toLocaleString() },
      { key: "download", label: "", sortable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
    ]} /></div>

    <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
    <ConfirmDialog open={confirmOpen} title="Generate this bank TXT instruction?" description="This creates a DEMO / NOT CERTIFIED instruction and changes each selected CXP to PAYMENT_FILE_CREATED. It does not confirm payment." details={[{ label: "Selected CXP", value: selected.length }, { label: "Bank", value: bank }, { label: "Currency", value: currency }, { label: "Payment date", value: paymentDate }, { label: "Total", value: money(currency, selectedTotal) }]} confirmLabel="Generate bank TXT" loading={processing} onClose={() => !processing && setConfirmOpen(false)} onConfirm={generate} />

    <Drawer open={Boolean(paymentRow)} title="Confirm actual bank payment" description={paymentRow ? `${paymentRow.requestNumber} - ${paymentRow.supplier?.legalName || paymentRow.supplier?.name || "UMA collaborator"}` : ""} onClose={() => !processing && setPaymentRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setPaymentRow(null)}>{t("Cancel")}</button><button type="submit" form="payment-confirmation-form" className="primary-button" disabled={processing}><CircleCheckBig size={16} />{t(processing ? "Processing..." : "Confirm payment")}</button></>}><div className="document-requirement required"><AlertTriangle size={20} /><div><strong>{t("This settles the selected Accounts Payable record")}</strong><p>{t("Confirmation posts the payment journal and does not infer payment from a downloaded TXT.")}</p></div></div><form id="payment-confirmation-form" className="form-grid" onSubmit={confirmPayment}><label className="field"><span>{t("Operation number")} *</span><input required value={paymentForm.operationNumber} onChange={(event) => setPaymentForm({ ...paymentForm, operationNumber: event.target.value })} /></label><label className="field"><span>{t("Actual payment date")} *</span><input required type="date" value={paymentForm.paidAt} onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })} /></label><label className="field"><span>{t("Confirmed amount")} *</span><input required type="number" min="0.01" step="0.01" value={paymentForm.confirmedAmount} onChange={(event) => setPaymentForm({ ...paymentForm, confirmedAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={paymentForm.comments} onChange={(event) => setPaymentForm({ ...paymentForm, comments: event.target.value })} /></label></form></Drawer>

    <Drawer open={Boolean(bounceRow)} title="Report bounced payment" description={bounceRow?.requestNumber || ""} onClose={() => !processing && setBounceRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setBounceRow(null)}>{t("Cancel")}</button><button type="submit" form="bounce-payment-form" className="danger-button" disabled={processing}><XCircle size={16} />{t("Mark PAGO_REBOTADO")}</button></>}><form id="bounce-payment-form" className="form-grid" onSubmit={reportBounce}><label className="field"><span>{t("Bank rejection reason")} *</span><textarea required rows="4" value={bounceForm.reason} onChange={(event) => setBounceForm({ ...bounceForm, reason: event.target.value })} /></label><label className="field"><span>{t("Bank reference")}</span><input value={bounceForm.bankReference} onChange={(event) => setBounceForm({ ...bounceForm, bankReference: event.target.value })} /></label></form></Drawer>

    <Drawer open={Boolean(reprogramRow)} title="Reprogram bounced payment" description={reprogramRow?.requestNumber || ""} onClose={() => !processing && setReprogramRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReprogramRow(null)}>{t("Cancel")}</button><button type="submit" form="reprogram-payment-form" className="primary-button" disabled={processing || !reprogramForm.cciLetter}><RotateCcw size={16} />{t("Reprogram")}</button></>}><div className="document-requirement required"><UploadCloud size={20} /><div><strong>{t("Signed CCI letter required")}</strong><p>{t("The previous payment destination remains auditable; the replacement evidence is stored before reopening the CXP.")}</p></div></div><form id="reprogram-payment-form" className="form-grid" onSubmit={reprogramPayment}><label className="field"><span>{t("Signed CCI letter")} *</span><input required type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setReprogramForm({ ...reprogramForm, cciLetter: event.target.files?.[0] || null })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reprogramForm.comments} onChange={(event) => setReprogramForm({ ...reprogramForm, comments: event.target.value })} /></label></form></Drawer>

    <Drawer open={Boolean(reconciliationRow)} title="Reconcile bank payment" description={reconciliationRow?.requestNumber || ""} onClose={() => !processing && setReconciliationRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReconciliationRow(null)}>{t("Cancel")}</button><button type="submit" form="reconciliation-form" className="primary-button" disabled={processing}><Scale size={16} />{t(processing ? "Processing..." : "Reconcile")}</button></>}><form id="reconciliation-form" className="form-grid" onSubmit={reconcile}><label className="field"><span>{t("Bank reference")} *</span><input required value={reconciliationForm.bankReference} onChange={(event) => setReconciliationForm({ ...reconciliationForm, bankReference: event.target.value })} /></label><label className="field"><span>{t("Statement amount")} *</span><input required type="number" min="0.01" step="0.01" value={reconciliationForm.statementAmount} onChange={(event) => setReconciliationForm({ ...reconciliationForm, statementAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reconciliationForm.comments} onChange={(event) => setReconciliationForm({ ...reconciliationForm, comments: event.target.value })} /></label></form></Drawer>
  </section>;
}
