import ReadinessPanel from "../components/ReadinessPanel.jsx";
import DateInput from "../components/DateInput.jsx";
import WorkspaceTools from "../components/WorkspaceTools.jsx";
import SectionNavigation from "../components/SectionNavigation.jsx";
import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CircleCheckBig,
  Landmark,
  Download,
  Eye,
  FileDown,
  ListChecks,
  LockKeyhole,
  RefreshCw,
  RotateCcw,
  Scale,
  Star,
  UploadCloud,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PaymentTermsSummary from "../components/PaymentTermsSummary.jsx";
import { paymentTermsSummary } from "../../../shared/paymentTerms.mjs";
import { isPaymentCycleDate, limaDateKey, nextPaymentCycleDate } from "../../../shared/businessCalendar.mjs";
import ProtectedAssetButton from "../components/ProtectedAssetButton.jsx";
import RequestQuickView from "../components/RequestQuickView.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { flowTypes, requestTypes } from "../utils/options.js";
import { formatCurrency, formatDate, formatDateTime } from "../utils/formatters.js";
const historicalSourceBanks = ["BBVA", "BCP", "INTERBANK", "SCOTIABANK"];

const amountOf = (row) => Number(row.accountsPayable?.outstandingAmount ?? row.outstandingAmount ?? row.totalAmount ?? 0);
// What goes to the supplier through BBVA: outstanding minus a pending SPOT detraccion.
const netAmountOf = (row) => Number(row.accountsPayable?.netPayableAmount ?? amountOf(row));
const onPaymentCycle = (dateKey) => Boolean(dateKey) && isPaymentCycleDate(new Date(`${dateKey}T12:00:00.000Z`));
const requestIdOf = (row) => row.requestId || row.request?._id || row._id;
const payableIdOf = (row) => row.accountsPayable?._id || row._id;
const PAYMENT_VIEWS = ["prepare", "confirm", "detractions", "reconcile", "returned"];

// Where a payable is in Treasury's procedure, shown in the details panel.
function paymentSteps(row) {
  const payable = row.accountsPayable || row;
  const status = payable.status;
  const filed = ["PAYMENT_FILE_CREATED", "PARTIALLY_PAID", "PAID"].includes(status);
  const paid = status === "PAID";
  const detraction = payable.detraction?.status && payable.detraction.status !== "NOT_APPLICABLE" ? payable.detraction.status : null;
  const reconciled = Boolean(payable.reconciliation || payable.reconciledAt || row.reconciliation);
  const steps = [
    { label: "Scheduled", done: Boolean(status) && status !== "OPEN" || filed },
    { label: "Bank file generated", done: filed },
    { label: status === "PARTIALLY_PAID" ? "Payment confirmed (partial)" : "Payment confirmed", done: paid },
    ...(detraction ? [{ label: "Detraction deposit", done: detraction === "DEPOSITED" }] : []),
    { label: "Reconciled", done: reconciled }
  ];
  const current = steps.findIndex((step) => !step.done);
  return steps.map((step, index) => ({ label: step.label, state: step.done ? "done" : index === current ? "current" : "todo" }));
}

export default function TreasuryQueue({ historyOnly = false }) {
  const [paymentView, setPaymentView] = useState("prepare");
  const { t, language } = useLanguage();
  const money = (currencyCode, value) => formatCurrency(value, currencyCode || "PEN", language);
  const { notify } = useToast();
  const [selected, setSelected] = useState([]);
  const [accountSelections, setAccountSelections] = useState({});
  const [bank, setBank] = useState("BBVA");
  const [currency, setCurrency] = useState("PEN");
  // Payments follow the university cycle (15th / 30th): default to the next cycle date.
  const todayKey = limaDateKey(new Date());
  const [paymentDate, setPaymentDate] = useState(() => nextPaymentCycleDate(new Date()));
  const [paymentDateReason, setPaymentDateReason] = useState("");
  const offCycle = !onPaymentCycle(paymentDate);
  const [quickViewId, setQuickViewId] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ operationNumber: "", paidAt: new Date().toISOString().slice(0, 10), confirmedAmount: "", comments: "" });
  const [bounceRow, setBounceRow] = useState(null);
  const [bounceForm, setBounceForm] = useState({ reason: "", reasonCategory: "", bankReference: "" });
  const [reprogramRow, setReprogramRow] = useState(null);
  const [reprogramForm, setReprogramForm] = useState({ comments: "", cciLetter: null });
  const [reconciliationRow, setReconciliationRow] = useState(null);
  const [reconciliationForm, setReconciliationForm] = useState({ bankReference: "", statementAmount: "", comments: "" });
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState("");
  const [detractionRow, setDetractionRow] = useState(null);
  const [detractionForm, setDetractionForm] = useState({ constancyNumber: "", depositDate: "", amount: "" });

  const paymentDraft = useWorkDraft({ scope: "payment-confirmation", recordId: paymentRow ? String(payableIdOf(paymentRow)) : "new", title: "Payment confirmation", enabled: Boolean(paymentRow), value: paymentForm, restore: setPaymentForm, sourceVersion: paymentRow?.updatedAt });
  useDraftResume("payment-confirmation", id => resumeDraftRecord("/treasury/payment-confirmations", id, payableIdOf, openPaymentConfirmation, setActionError));
  const bounceDraft = useWorkDraft({ scope: "payment-bounce", recordId: bounceRow ? String(payableIdOf(bounceRow)) : "new", title: "Payment bounce", enabled: Boolean(bounceRow), value: bounceForm, restore: setBounceForm, sourceVersion: bounceRow?.updatedAt });
  useDraftResume("payment-bounce", id => resumeDraftRecord("/treasury/payment-confirmations", id, payableIdOf, setBounceRow, setActionError));
  const reprogramDraft = useWorkDraft({ scope: "payment-reprogram", recordId: reprogramRow ? String(payableIdOf(reprogramRow)) : "new", title: "Payment reprogram", enabled: Boolean(reprogramRow), value: reprogramForm, restore: setReprogramForm, sourceVersion: reprogramRow?.updatedAt });
  useDraftResume("payment-reprogram", id => resumeDraftRecord("/treasury/bounced-payments", id, payableIdOf, setReprogramRow, setActionError));
  const reconciliationDraft = useWorkDraft({ scope: "payment-reconciliation", recordId: reconciliationRow ? String(payableIdOf(reconciliationRow)) : "new", title: "Payment reconciliation", enabled: Boolean(reconciliationRow), value: reconciliationForm, restore: setReconciliationForm, sourceVersion: reconciliationRow?.updatedAt });
  useDraftResume("payment-reconciliation", id => resumeDraftRecord("/treasury/reconciliation", id, payableIdOf, openReconciliation, setActionError));

  // Notification links: /treasury?tab=<stage>&record=<CXP id> or ?request=<request id>. Every stage
  // table narrows to the linked CXP(s); the named stage opens, or else the first stage holding it.
  const deepLink = useDeepLink(["record", "request"]);
  const linkActive = deepLink.active && !historyOnly;
  const linkParams = linkActive ? deepLink.link : {};
  const linkOptions = { fixedParams: linkParams, deepLink: linkActive };
  // The linked CXP is listed whatever its currency; the currency selector follows it (below).
  const queueTable = usePaginatedResource("/treasury/queue", { fixedParams: linkActive ? { bank, ...linkParams } : { bank, currency }, persistKey: "treasury-queue", deepLink: linkActive });
  const historyTable = usePaginatedResource("/treasury/bank-files");
  const confirmationTable = usePaginatedResource("/treasury/payment-confirmations", linkOptions);
  const bouncedTable = usePaginatedResource("/treasury/bounced-payments", linkOptions);
  const reconciliationTable = usePaginatedResource("/treasury/reconciliation", linkOptions);
  const detractionTable = usePaginatedResource("/treasury/detractions", linkOptions);
  const stageTables = { prepare: queueTable, confirm: confirmationTable, detractions: detractionTable, reconcile: reconciliationTable, returned: bouncedTable };
  const stageTotals = PAYMENT_VIEWS.map((view) => stageTables[view].loading ? null : Number(stageTables[view].pagination.total || 0));
  const stageTotalsKey = stageTotals.join(",");
  const linkMissing = linkActive && stageTotals.every((total) => total === 0);
  const linkResolved = useRef("");
  useEffect(() => {
    linkResolved.current = "";
    if (linkActive && PAYMENT_VIEWS.includes(deepLink.tab)) setPaymentView(deepLink.tab);
  }, [deepLink.linkKey, deepLink.tab, linkActive]);
  // A plain stage link (/treasury?tab=confirm, from a task or the menu) opens that stage even
  // when it names no record.
  useEffect(() => {
    if (!linkActive && PAYMENT_VIEWS.includes(deepLink.tab)) setPaymentView(deepLink.tab);
  }, [deepLink.tab, linkActive]);
  useEffect(() => {
    const linkId = deepLink.linkKey + deepLink.tab;
    if (!linkActive || linkResolved.current === linkId || stageTotals.some((total) => total === null)) return;
    linkResolved.current = linkId;
    const named = PAYMENT_VIEWS.indexOf(deepLink.tab);
    if (named >= 0 && stageTotals[named] > 0) return;
    const found = stageTotals.findIndex((total) => total > 0);
    if (found >= 0) setPaymentView(PAYMENT_VIEWS[found]);
  }, [deepLink.linkKey, deepLink.tab, linkActive, stageTotalsKey]);
  useEffect(() => {
    const linked = linkActive ? queueTable.rows[0] : null;
    const linkedCurrency = linked?.accountsPayable?.currency || linked?.currency;
    if (linkedCurrency && linkedCurrency !== currency) setCurrency(linkedCurrency);
  }, [linkActive, queueTable.rows]);
  const rows = queueTable.rows;
  const loading = queueTable.loading || historyTable.loading || confirmationTable.loading || bouncedTable.loading || reconciliationTable.loading || detractionTable.loading;
  const resourceError = queueTable.error || historyTable.error || confirmationTable.error || bouncedTable.error || reconciliationTable.error || detractionTable.error;

  function reloadAll() {
    queueTable.reload();
    historyTable.reload();
    confirmationTable.reload();
    bouncedTable.reload();
    reconciliationTable.reload();
    detractionTable.reload();
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
        const eligible = accounts.filter((account) => account.currency === currency);
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
      if (row.paymentDestination.currency === currency) return [row.paymentDestination];
      return [];
    }
    if (row.destinationLocked || row.paymentDestination) {
      if (row.paymentDestination?.currency === currency) return [row.paymentDestination];
      return [];
    }
    return (row.eligibleBankAccounts || row.activeBankAccounts || []).filter((account) => account.currency === currency);
  };
  const destinationBank = (row) => {
    if (row.paymentDestination) return row.paymentDestination.bank;
    return "";
  };
  const selectedRows = rows.filter((row) => selected.includes(String(payableIdOf(row))));
  const selectedTotal = useMemo(() => selectedRows.reduce((sum, row) => sum + netAmountOf(row), 0), [selectedRows]);
  // Bulk selection: DataTable keys the checkbox column by the CXP id, and only rows with an
  // eligible account in the file currency can be selected.
  const queueRows = useMemo(() => rows.map((row) => ({ ...row, selectionKey: String(payableIdOf(row)) })), [rows]);
  const isSelectable = (row) => matchingAccounts(row).length > 0;
  const selectableOnPage = queueRows.filter(isSelectable);
  const allOnPageSelected = selectableOnPage.length > 0 && selectableOnPage.every((row) => selected.includes(row.selectionKey));
  const selectedByCurrency = Object.entries(selectedRows.reduce((totals, row) => {
    const code = row.accountsPayable?.currency || row.currency || currency;
    totals[code] = (totals[code] || 0) + netAmountOf(row);
    return totals;
  }, {}));
  const selectAllVisible = () => setSelected((current) => [...new Set([...current, ...selectableOnPage.map((row) => row.selectionKey)])]);
  const paymentCycles = queueTable.payload.summary?.paymentCycles || [];
  const queueTotals = useMemo(() => Object.fromEntries(Object.entries(queueTable.payload.summary?.totalsByCurrency || {}).map(([key, value]) => [key, Number(value.total || 0)])), [queueTable.payload.summary]);
  const missingBank = Number(queueTable.payload.summary?.missingBankDetails || 0);

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
        paymentDateReason: offCycle ? paymentDateReason : undefined,
        accountSelections: selectedAccounts
      });
      setResult(response.data);
      // The generated CXPs leave the queue; the selection is cleared so none is sent twice.
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
      confirmedAmount: String(netAmountOf(row)),
      comments: ""
    });
  }

  async function confirmPayment(event) {
    event.preventDefault(); if (!paymentDraft.ready || paymentDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/payables/${payableIdOf(paymentRow)}/confirm-payment`, paymentForm);
      await paymentDraft.complete();
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
    event.preventDefault(); if (!bounceDraft.ready || bounceDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/payables/${payableIdOf(bounceRow)}/bounce`, bounceForm);
      await bounceDraft.complete();
      notify("The rejected transfer was reopened as PAGO_REBOTADO.");
      setBounceRow(null);
      setBounceForm({ reason: "", reasonCategory: "", bankReference: "" });
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
    event.preventDefault(); if (!reprogramDraft.ready || reprogramDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    try {
      const data = new FormData();
      data.append("comments", reprogramForm.comments);
      if (reprogramForm.cciLetter) data.append("cciLetter", reprogramForm.cciLetter);
      await api.post(`/treasury/payables/${payableIdOf(reprogramRow)}/reprogram`, data);
      await reprogramDraft.complete();
      notify(reprogramForm.cciLetter ? "Signed CCI evidence stored. The CXP is available for Treasury scheduling again." : "The CXP is back in the payment queue for a retry.");
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
    // The statement amount must be typed from the bank statement: pre-filling it with the system
    // amount would make the check compare the system with itself.
    setReconciliationForm({ bankReference: "", statementAmount: "", comments: "" });
  }

  async function cancelFile(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/bank-files/${cancelTarget.batchId}/cancel`, { reason: cancelReason, accountsPayableIds: cancelTarget.accountsPayableId ? [cancelTarget.accountsPayableId] : undefined });
      notify(cancelTarget.accountsPayableId ? "The CXP was removed from the bank file and is back in the payment queue." : "Bank file cancelled. Its CXP records are back in the payment queue.");
      setCancelTarget(null);
      setCancelReason("");
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  function openDetraction(row) {
    setDetractionRow(row);
    setDetractionForm({ constancyNumber: "", depositDate: todayKey, amount: "" });
  }

  async function depositDetraction(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/payables/${payableIdOf(detractionRow)}/detraction-deposit`, detractionForm);
      notify("Detraction deposit recorded.");
      setDetractionRow(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      notify(error.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  const detractionCell = (row) => {
    const detraction = row.accountsPayable?.detraction || row.detraction;
    if (!detraction || detraction.status === "NOT_APPLICABLE" || !detraction.status) return <span className="field-hint">{t("Not subject to SPOT")}</span>;
    return <div className="primary-cell"><strong>{money("PEN", detraction.amountPen)} · {detraction.rate}%</strong><span><StatusBadge status={detraction.status === "DEPOSITED" ? "DETRACTION_DEPOSITED" : "DETRACTION_PENDING"} /> {detraction.categoryCode}</span></div>;
  };

  async function reconcile(event) {
    event.preventDefault(); if (!reconciliationDraft.ready || reconciliationDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post(`/treasury/payables/${payableIdOf(reconciliationRow)}/reconcile`, reconciliationForm);
      await reconciliationDraft.complete();
      notify("Payment reconciled. Request progress has been updated.");
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

  const reprogramLetterRequired = reprogramRow?.accountsPayable?.bouncedPayment?.reasonCategory !== "TECHNICAL";

  const queueColumns = [
    { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <button type="button" className="link-button" onClick={() => setQuickViewId(requestIdOf(row))}>{row.requestNumber}</button> },
    { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator")}</strong><span>{row.accountsPayable?.voucher?.series ? `${row.accountsPayable.voucher.series}-${row.accountsPayable.voucher.number}` : row.accountsPayable?.supplierIdentifierSnapshot || "-"}</span></div> },
    { key: "flowType", type: "code", label: "Track", getValue: (row) => row.accountsPayable?.flowType || row.flowType, render: (row) => <StatusBadge status={row.accountsPayable?.flowType || row.flowType} /> },
    { key: "priority", label: "Priority", getValue: (row) => row.accountsPayable?.paymentPriority, render: (row) => <StatusBadge status={row.accountsPayable?.paymentPriority || "NORMAL"} /> },
    { key: "account", primary: true, minWidth: "220px", label: "Payment destination snapshot", sortable: false, render: (row) => {
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
    { key: "status", type: "status", label: "CXP status", getValue: (row) => row.accountsPayable?.status, render: (row) => <StatusBadge status={row.accountsPayable?.status} /> },
    { key: "paymentCycle", type: "date", label: "Payment cycle", sortable: false, getValue: (row) => row.accountsPayable?.paymentCycleDate, render: (row) => row.accountsPayable?.paymentCycleDate ? <span className="primary-cell"><strong>{formatDate(`${row.accountsPayable.paymentCycleDate}T12:00:00Z`)}</strong>{row.accountsPayable?.scheduleOverride?.reason && <small>{t("Off-cycle")}: {row.accountsPayable.scheduleOverride.reason}</small>}</span> : "-" },
    { key: "amount", type: "money", sortKey: "outstandingAmount", label: "Outstanding", getValue: amountOf, render: (row) => <div className="primary-cell"><strong>{money(row.accountsPayable?.currency || row.currency, amountOf(row))}</strong>{netAmountOf(row) !== amountOf(row) && <small>{t("Net transfer")}: {money(row.accountsPayable?.currency || row.currency, netAmountOf(row))}</small>}</div> },
    { key: "detraction", label: "Detraction (SPOT)", sortable: false, render: detractionCell },
    { key: "paymentTerms", label: "Payment Terms", sortable: false, getValue: (row) => paymentTermsSummary(row.accountsPayable?.paymentTermsSnapshot || row.paymentTermsSnapshot || {}, t), render: (row) => <PaymentTermsSummary terms={row.accountsPayable?.paymentTermsSnapshot || row.paymentTermsSnapshot} showAmounts={false} /> },
    { key: "dueDate", type: "date", primary: true, label: "Due date", getValue: (row) => row.accountsPayable?.dueDate, render: (row) => row.accountsPayable?.dueDate ? formatDate(row.accountsPayable.dueDate) : row.accountsPayable?.paymentTermsSnapshot?.paymentCondition ? <span className="cell-note">{t("Date to be confirmed under the agreed terms")}</span> : "-" }
  ];

  return <section>
      <PageHeader title={historyOnly ? "Payment History" : "Payments"} description="Schedule and confirm payments." actions={<button type="button" className="secondary-button" onClick={reloadAll} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
      <WorkspaceTools links={[["Reimbursement Banking", "/reimbursement-bank"], ["Suppliers", "/suppliers"], ["Management Reports", "/reports"]]} />
    <Message type="error">{actionError || resourceError}</Message>
    {!historyOnly && selected.length > 0 && <ReadinessPanel paymentPayload={{ payableIds: selected, currency, accountSelections }} />}
    {linkActive && <DeepLinkNotice title="Showing the payment linked from your notification" missing={linkMissing} missingDescription="This payment is no longer pending in any Treasury stage. It may already be paid and reconciled." clearLabel="Show all payments" onClear={deepLink.clear} />}
    <div hidden={historyOnly} className="stats-grid"><StatCard label="Payable queue" value={queueTable.pagination.total} tone="amber" /><StatCard label="Missing bank details" value={missingBank} tone={missingBank ? "red" : "green"} /><StatCard label="Payment confirmation" value={confirmationTable.pagination.total} tone="amber" /><StatCard label="Bounced payments" value={bouncedTable.pagination.total} tone={bouncedTable.pagination.total ? "red" : "green"} /></div>

    {missingBank > 0 && <div className="alert-strip error"><AlertTriangle size={20} /><div><strong>{t("Some payments are blocked")}</strong><p>{t("A payment needs a verified eligible current account, or the immutable employee reimbursement destination, before file generation.")}</p></div></div>}

    <nav className="focus-tabs" aria-label={t("Payment stages")}>{!historyOnly && [["prepare", "Pending payments"], ["confirm", "Confirm payments"], ["detractions", "Detractions"], ["reconcile", "Reconciliation"], ["returned", "Returned payments"]].map(([key, label]) => <button type="button" key={key} aria-pressed={paymentView === key} onClick={() => setPaymentView(key)}>{t(label)}</button>)}<Link to={historyOnly ? "/treasury" : "/treasury/history"}>{t(historyOnly ? "Payments" : "Payment History")}</Link></nav>
    <div hidden={historyOnly || paymentView !== "prepare"}>
    <div id="treasury-prepare" className="workspace-panel treasury-file-controls"><div className="section-heading"><div><h3>{t("Bank file preparation")}</h3><p>{t("Select invoices to include in the BBVA payment file.")}</p></div></div><div className="filter-row"><label className="field"><span>{t("UMA source bank")}</span><input value={bank} readOnly aria-readonly="true" /><small className="field-hint">{t("New payment files use BBVA. Beneficiary accounts may use another bank through CCI.")}</small></label><label className="field"><span>{t("Currency")}</span><select value={currency} onChange={(event) => { setCurrency(event.target.value); setSelected([]); }}><option value="PEN">PEN</option><option value="USD">USD</option></select></label><label className="field"><span>{t("Payment date")}</span><DateInput min={todayKey} value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} /><small className="field-hint">{t("Payments run on the 15th and the 30th of each month.")}</small></label>{offCycle && <label className="field"><span>{t("Reason for paying off the payment cycle")} *</span><input required value={paymentDateReason} onChange={(event) => setPaymentDateReason(event.target.value)} /></label>}</div>{paymentCycles.length > 0 && <div className="filter-row" aria-label={t("Payment cycles")}>{paymentCycles.map((group) => <span key={group.date} className="badge badge-blue"><CalendarClock size={12} />{formatDate(`${group.date}T12:00:00Z`)} · {group.count} · {Object.entries(group.totals).map(([code, value]) => money(code, value)).join(" / ")}</span>)}</div>}</div>

    {result && <div className="success-result" role="status"><div><strong>{t("Bank instruction generated")}</strong><span>{result.fileName} · {result.notice}</span></div>{result.url && <ProtectedAssetButton className="secondary-button" resourcePath={result.url} fileName={result.fileName}><Download size={16} />{t("Download")}</ProtectedAssetButton>}</div>}

    <div className="workspace-panel section-spacer"><DataTable detailSteps={paymentSteps} rows={queueRows} rowKey="selectionKey" emptyTitle="No payments pending" emptyDescription="Approved CXP records appear here when they are ready to be paid." emptyAction={{ label: "Payment History", to: "/treasury/history" }} selection={{ selected, onChange: setSelected, isRowSelectable: isSelectable }} toolbarActions={<button type="button" className="secondary-button" disabled={!selectableOnPage.length || allOnPageSelected} onClick={selectAllVisible}><ListChecks size={16} /><span>{t("Select all visible")}</span></button>} loading={queueTable.loading} remote={queueTable.remote} filters={[{ key: "requestType", label: "types", allLabel: "All types", options: requestTypes }, { key: "flowType", label: "tracks", allLabel: "All tracks", options: flowTypes }, { key: "paymentPriority", label: "priorities", allLabel: "All priorities", options: ["NORMAL", "PRIORITY"] }]} searchPlaceholder="Search request, supplier, voucher, or cost center..." rowActions={(row) => [{ label: "Open request", icon: Eye, onClick: () => setQuickViewId(requestIdOf(row)) }]} columns={queueColumns} />
    {selected.length > 0 && <div className="bulk-bar" role="region" aria-label={t("Bank file selection")}><div className="bulk-bar-summary"><strong>{t("{count} CXP records selected").replace("{count}", selected.length)}</strong><span>{selectedByCurrency.map(([code, value]) => money(code, value)).join(" · ")}</span></div><div className="bulk-bar-actions"><button type="button" className="primary-button" disabled={processing || (offCycle && !paymentDateReason.trim())} onClick={() => setConfirmOpen(true)}><FileDown size={16} /><span>{t("Generate file")}</span></button><button type="button" className="text-button" onClick={() => setSelected([])}>{t("Clear selection")}</button></div>{offCycle && !paymentDateReason.trim() && <p className="bulk-bar-note">{t("Enter the reason for paying off the payment cycle to generate the file.")}</p>}</div>}
    </div>

    </div>
    <div hidden={historyOnly || paymentView !== "confirm"} id="treasury-confirm" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Payment confirmation")}</h3><p>{t("Confirm the item or report the bank rejection. A rejected item becomes PAGO_REBOTADO without cancelling other invoices in the same request.")}</p></div><span className="section-count">{confirmationTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={confirmationTable.rows} loading={confirmationTable.loading} remote={confirmationTable.remote} emptyTitle="No payments to confirm" emptyDescription="Payments appear here after their bank file is generated." emptyAction={{ label: "Pending payments", onClick: () => setPaymentView("prepare") }} rowActions={(row) => [{ label: "Confirm payment", icon: CircleCheckBig, primary: true, onClick: () => openPaymentConfirmation(row) }, { label: "Report bounced payment", icon: XCircle, onClick: () => { setBounceRow(row); setBounceForm({ reason: "", reasonCategory: "", bankReference: "" }); } }, { label: "Remove from bank file", icon: Ban, tone: "danger", disabled: row.accountsPayable?.status !== "PAYMENT_FILE_CREATED", disabledReason: row.accountsPayable?.status === "PAYMENT_FILE_CREATED" ? undefined : "Only possible before any payment of this file is confirmed.", onClick: () => { setCancelTarget({ batchId: row.accountsPayable?.paymentBatch?._id, batchNumber: row.accountsPayable?.paymentBatch?.batchNumber, accountsPayableId: payableIdOf(row) }); setCancelReason(""); } }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator") },
      { key: "flowType", type: "code", label: "Track", render: (row) => <StatusBadge status={row.accountsPayable?.flowType || row.flowType} /> },
      { key: "batch", type: "code", label: "Bank batch", sortable: false, render: (row) => `${row.accountsPayable?.paymentBatch?.batchNumber || "-"} / ${row.accountsPayable?.paymentBatch?.bank || "-"}` },
      { key: "status", type: "status", label: "CXP status", render: (row) => <StatusBadge status={row.accountsPayable?.status} /> },
      { key: "amount", type: "money", label: "Amount", getValue: netAmountOf, render: (row) => <strong>{money(row.accountsPayable?.currency || row.currency, netAmountOf(row))}</strong> },
      { key: "detraction", label: "Detraction (SPOT)", sortable: false, render: detractionCell }
    ]} /></div>

    <div hidden={historyOnly || paymentView !== "detractions"} id="treasury-detractions" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Detraction deposits")}</h3><p>{t("Deposit the SPOT detraction in the supplier's Banco de la Nación account and record the constancia. The CXP is fully paid only after the net transfer and this deposit.")}</p></div><span className="section-count">{detractionTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={detractionTable.rows} loading={detractionTable.loading} remote={detractionTable.remote} rowActions={(row) => [{ label: "Record detraction deposit", icon: Landmark, disabled: !row.detractionAccountRegistered, disabledReason: row.detractionAccountRegistered ? undefined : "The supplier has no Banco de la Nación detracciones account.", onClick: () => openDetraction(row) }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${row.requestId}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || "-" },
      { key: "category", type: "code", primary: true, label: "SPOT category", sortable: false, render: (row) => `${row.detraction?.categoryCode || "-"} · ${row.detraction?.rate ?? "-"}%` },
      { key: "account", label: "Banco de la Nación account", sortable: false, render: (row) => row.detractionAccountRegistered ? `****${row.detractionAccountLast4}` : <span className="blocked-inline"><AlertTriangle size={14} />{t("Missing")}</span> },
      { key: "netTransfer", type: "money", label: "Net transfer pending", sortable: false, render: (row) => money(row.currency, row.netTransferPending) },
      { key: "amount", type: "money", label: "Detraction", sortable: false, render: (row) => <strong>{money("PEN", row.detraction?.amountPen)}</strong> }
    ]} /></div>

    <div hidden={historyOnly || paymentView !== "returned"} id="treasury-returned" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Bounced payment reprogramming")}</h3><p>{t("A signed CCI letter is required when the bank rejected the beneficiary's bank details. A technical rejection on a verified account can be retried without a new letter.")}</p></div><span className="section-count">{bouncedTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={bouncedTable.rows} loading={bouncedTable.loading} remote={bouncedTable.remote} rowActions={(row) => [{ label: row.accountsPayable?.bouncedPayment?.reasonCategory === "TECHNICAL" ? "Retry payment" : "Upload CCI letter and reprogram", icon: RotateCcw, onClick: () => { setReprogramRow(row); setReprogramForm({ comments: "", cciLetter: null }); } }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator") },
      { key: "reason", primary: true, label: "Bank rejection", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.accountsPayable?.bouncedPayment?.reason || "-"}</strong><span>{t(row.accountsPayable?.bouncedPayment?.reasonCategory || "BANK_DETAILS")} · {row.accountsPayable?.bouncedPayment?.bankReference || "-"}</span></div> },
      { key: "status", type: "status", label: "Status", render: (row) => <StatusBadge status={row.accountsPayable?.status || "PAYMENT_BOUNCED"} /> },
      { key: "amount", type: "money", label: "Outstanding", render: (row) => <strong>{money(row.currency, amountOf(row))}</strong> }
    ]} /></div>

    <div hidden={historyOnly || paymentView !== "reconcile"} id="treasury-reconcile" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Reconciliation")}</h3><p>{t("Match all confirmed CXP payments to the bank statement before Accounting closure.")}</p></div><span className="section-count">{reconciliationTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={reconciliationTable.rows} loading={reconciliationTable.loading} remote={reconciliationTable.remote} emptyTitle="Nothing to reconcile" emptyDescription="Confirmed payments appear here until they are matched to the bank statement." emptyAction={{ label: "Confirm payments", onClick: () => setPaymentView("confirm") }} rowActions={(row) => [{ label: "Reconcile payment", icon: Scale, onClick: () => openReconciliation(row) }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator") },
      { key: "voucher", type: "code", primary: true, label: "Voucher", sortable: false, render: (row) => [row.accountsPayable?.voucher?.series, row.accountsPayable?.voucher?.number].filter(Boolean).join("-") || "-" },
      { key: "operation", type: "code", label: "Operation number", render: (row) => row.payment?.operationNumber || "-" },
      { key: "paidAt", type: "date", primary: true, label: "Paid date", render: (row) => row.payment?.paidAt ? formatDate(row.payment.paidAt) : "-" },
      { key: "status", type: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "amount", type: "money", label: "Confirmed", render: (row) => <strong>{money(row.currency, row.payment?.confirmedAmount)}</strong> }
    ]} /></div>

    <div hidden={!historyOnly} id="treasury-history" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Generated bank-file history")}</h3><p>{t("Download previously generated payment files.")}</p></div></div><DataTable rows={historyTable.rows} loading={historyTable.loading} remote={historyTable.remote} emptyTitle="No bank files yet" emptyDescription="Bank files generated from the payment queue are kept here." emptyAction={{ label: "Payments", to: "/treasury" }} rowActions={(row) => [{ label: "Cancel bank file", icon: Ban, tone: "danger", hidden: row.status !== "GENERATED" || (row.items || []).some((item) => ["CONFIRMED", "PARTIALLY_CONFIRMED"].includes(item.status)), onClick: () => { setCancelTarget({ batchId: row._id, batchNumber: row.batchNumber }); setCancelReason(""); } }]} filters={[{ key: "bank", label: "banks", allLabel: "All banks", options: historicalSourceBanks }, { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
      { key: "batchNumber", type: "code", label: "Batch" },
      { key: "fileName", type: "name", label: "File", render: (row) => <ProtectedAssetButton resourcePath={row.url} fileName={row.fileName}>{row.fileName}</ProtectedAssetButton> },
      { key: "bank", type: "code", primary: true, label: "Bank" },
      { key: "currency", type: "code", label: "Currency" },
      { key: "items", type: "number", label: "CXP items", sortable: false, render: (row) => row.items?.length || 0 },
      { key: "totalAmount", type: "money", label: "Total", render: (row) => money(row.currency, row.totalAmount) },
      { key: "status", type: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "generatedAt", type: "date", primary: true, label: "Generated", render: (row) => formatDateTime(row.generatedAt) },
      { key: "download", label: "Download", sortable: false, exportable: false, render: (row) => <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download"><Download size={16} /></ProtectedAssetButton> }
    ]} /></div>

    <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
    <ConfirmDialog open={confirmOpen} title="Generate this bank TXT instruction?" description="Generate a BBVA fixed-width payment instruction. Payment remains pending until bank execution is confirmed." details={[{ label: "Selected CXP", value: selected.length }, { label: "Bank", value: bank }, { label: "Currency", value: currency }, { label: "Payment date", value: paymentDate }, ...(offCycle ? [{ label: "Reason for paying off the payment cycle", value: paymentDateReason }] : []), { label: "Total", value: selectedByCurrency.length ? selectedByCurrency.map(([code, value]) => money(code, value)).join(" · ") : money(currency, selectedTotal) }]} confirmLabel="Generate bank TXT" loading={processing} onClose={() => !processing && setConfirmOpen(false)} onConfirm={generate} />

    <Drawer open={Boolean(paymentRow)} title="Confirm actual bank payment" description={paymentRow ? `${paymentRow.requestNumber} - ${paymentRow.supplier?.legalName || paymentRow.supplier?.name || t("UMA collaborator")}` : ""} onClose={() => !processing && setPaymentRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setPaymentRow(null)}>{t("Cancel")}</button><button type="submit" form="payment-confirmation-form" className="primary-button" disabled={processing}><CircleCheckBig size={16} />{t(processing ? "Processing..." : "Confirm payment")}</button></>}><div className="document-requirement required"><AlertTriangle size={20} /><div><strong>{t("This settles the selected Accounts Payable record")}</strong><p>{t("Confirmation posts the payment journal and does not infer payment from a downloaded TXT. Enter less than the outstanding amount to record a partial payment; the remaining balance stays open for a later confirmation.")}</p></div></div><DraftPanel busy={processing} draft={paymentDraft} onDiscard={() => setPaymentRow(null)}><form id="payment-confirmation-form" className="form-grid" onSubmit={confirmPayment}><label className="field"><span>{t("Operation number")} *</span><input required value={paymentForm.operationNumber} onChange={(event) => setPaymentForm({ ...paymentForm, operationNumber: event.target.value })} /></label><label className="field"><span>{t("Actual payment date")} *</span><DateInput required value={paymentForm.paidAt} onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })} /></label><label className="field"><span>{t("Confirmed amount")} *</span><input required type="number" min="0.01" max={paymentRow ? amountOf(paymentRow) : undefined} step="0.01" value={paymentForm.confirmedAmount} onChange={(event) => setPaymentForm({ ...paymentForm, confirmedAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={paymentForm.comments} onChange={(event) => setPaymentForm({ ...paymentForm, comments: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(bounceRow)} title="Report bounced payment" description={bounceRow?.requestNumber || ""} onClose={() => !processing && setBounceRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setBounceRow(null)}>{t("Cancel")}</button><button type="submit" form="bounce-payment-form" className="danger-button" disabled={processing}><XCircle size={16} />{t("Mark PAGO_REBOTADO")}</button></>}><DraftPanel busy={processing} draft={bounceDraft} onDiscard={() => setBounceRow(null)}><form id="bounce-payment-form" className="form-grid" onSubmit={reportBounce}><label className="field"><span>{t("Rejection type")} *</span><select required value={bounceForm.reasonCategory} onChange={(event) => setBounceForm({ ...bounceForm, reasonCategory: event.target.value })}><option value="">{t("Select")}</option><option value="BANK_DETAILS">{t("Incorrect, invalid, changed or unverified bank details")}</option><option value="TECHNICAL">{t("Technical or temporary bank problem")}</option></select><small className="field-hint">{t("Bank-details rejections flag the account until Accounting re-verifies it and need a signed CCI letter.")}</small></label><label className="field"><span>{t("Bank rejection reason")} *</span><textarea required rows="4" value={bounceForm.reason} onChange={(event) => setBounceForm({ ...bounceForm, reason: event.target.value })} /></label><label className="field"><span>{t("Bank reference")}</span><input value={bounceForm.bankReference} onChange={(event) => setBounceForm({ ...bounceForm, bankReference: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(reprogramRow)} title="Reprogram bounced payment" description={reprogramRow?.requestNumber || ""} onClose={() => !processing && setReprogramRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReprogramRow(null)}>{t("Cancel")}</button><button type="submit" form="reprogram-payment-form" className="primary-button" disabled={processing || (reprogramLetterRequired && !reprogramForm.cciLetter)}><RotateCcw size={16} />{t("Reprogram")}</button></>}><div className={`document-requirement${reprogramLetterRequired ? " required" : ""}`}><UploadCloud size={20} /><div><strong>{t(reprogramLetterRequired ? "Signed CCI letter required" : "Retry on the verified account")}</strong><p>{t(reprogramLetterRequired ? "The previous payment destination remains auditable; the replacement evidence is stored before reopening the CXP." : "The bank rejected the transfer for a technical reason. No new CCI letter is needed while the account stays verified.")}</p></div></div><DraftPanel busy={processing} draft={reprogramDraft} onDiscard={() => setReprogramRow(null)}><form id="reprogram-payment-form" className="form-grid" onSubmit={reprogramPayment}><label className="field"><span>{t("Signed CCI letter")}{reprogramLetterRequired ? " *" : ""} {reprogramForm.cciLetter?.name}</span><input required={reprogramLetterRequired && !reprogramForm.cciLetter} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setReprogramForm({ ...reprogramForm, cciLetter: event.target.files?.[0] || null })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reprogramForm.comments} onChange={(event) => setReprogramForm({ ...reprogramForm, comments: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(reconciliationRow)} title="Reconcile bank payment" description={reconciliationRow?.requestNumber || ""} onClose={() => !processing && setReconciliationRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReconciliationRow(null)}>{t("Cancel")}</button><button type="submit" form="reconciliation-form" className="primary-button" disabled={processing}><Scale size={16} />{t(processing ? "Processing..." : "Reconcile")}</button></>}><DraftPanel busy={processing} draft={reconciliationDraft} onDiscard={() => setReconciliationRow(null)}><form id="reconciliation-form" className="form-grid" onSubmit={reconcile}><label className="field"><span>{t("Bank reference")} *</span><input required value={reconciliationForm.bankReference} onChange={(event) => setReconciliationForm({ ...reconciliationForm, bankReference: event.target.value })} /></label><label className="field"><span>{t("Statement amount")} *</span><small className="field-hint">{t("Type the amount shown on the bank statement.")}</small><input required type="number" min="0.01" step="0.01" value={reconciliationForm.statementAmount} onChange={(event) => setReconciliationForm({ ...reconciliationForm, statementAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reconciliationForm.comments} onChange={(event) => setReconciliationForm({ ...reconciliationForm, comments: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(cancelTarget)} title={cancelTarget?.accountsPayableId ? "Remove from bank file" : "Cancel bank file"} description={cancelTarget?.batchNumber || ""} onClose={() => !processing && setCancelTarget(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setCancelTarget(null)}>{t("Close")}</button><button type="submit" form="cancel-bank-file-form" className="danger-button" disabled={processing || !cancelReason.trim()}><Ban size={16} />{t("Confirm cancellation")}</button></>}><div className="document-requirement"><AlertTriangle size={20} /><div><strong>{t("Only before any payment is confirmed")}</strong><p>{t("The CXP records return to the payment queue. This is not a bounce and needs no CCI letter; do not upload the cancelled file to the bank.")}</p></div></div><form id="cancel-bank-file-form" className="form-grid" onSubmit={cancelFile}><label className="field"><span>{t("Cancellation reason")} *</span><textarea required rows="3" value={cancelReason} onChange={(event) => setCancelReason(event.target.value)} /></label></form></Drawer>

    <Drawer open={Boolean(detractionRow)} title="Record detraction deposit" description={detractionRow ? `${detractionRow.requestNumber} - ${money("PEN", detractionRow.detraction?.amountPen)}` : ""} onClose={() => !processing && setDetractionRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setDetractionRow(null)}>{t("Cancel")}</button><button type="submit" form="detraction-deposit-form" className="primary-button" disabled={processing}><Landmark size={16} />{t("Record deposit")}</button></>}><form id="detraction-deposit-form" className="form-grid" onSubmit={depositDetraction}><label className="field"><span>{t("Constancia number")} *</span><input required value={detractionForm.constancyNumber} onChange={(event) => setDetractionForm({ ...detractionForm, constancyNumber: event.target.value })} /></label><label className="field"><span>{t("Deposit date")} *</span><DateInput required max={todayKey} value={detractionForm.depositDate} onChange={(event) => setDetractionForm({ ...detractionForm, depositDate: event.target.value })} /></label><label className="field"><span>{t("Deposited amount (PEN)")} *</span><input required type="number" min="1" step="1" value={detractionForm.amount} onChange={(event) => setDetractionForm({ ...detractionForm, amount: event.target.value })} /></label></form></Drawer>
  </section>;
}
