import PaymentBatchSummary from "../components/PaymentBatchSummary.jsx";
import PaymentSummaryDownload from "../components/PaymentSummaryDownload.jsx";
import { banks } from "../utils/options.js";
import { celebrate } from "../utils/celebrate.js";
import { useAuth } from "../context/AuthContext.jsx";
import DateInput from "../components/DateInput.jsx";
import WorkspaceTools from "../components/WorkspaceTools.jsx";
import SectionNavigation from "../components/SectionNavigation.jsx";
import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import ExcelImport from "../components/ExcelImport.jsx";
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
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Tabs, { tabPanelProps } from "../components/Tabs.jsx";
import PaymentTermsSummary from "../components/PaymentTermsSummary.jsx";
import { paymentTermsSummary } from "../../../shared/paymentTerms.mjs";
import { isPaymentCycleDate, isUrgencyPaymentDate, limaDateKey, nextPaymentCycleDate } from "../../../shared/businessCalendar.mjs";
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
import { PAYMENT_BLOCK_TEXT, paymentBlockFor } from "../utils/paymentBlock.js";
import "../styles/treasury.css";
import { todayIso } from "../utils/dateInput.js";
import PriorityBadge from "../components/PriorityBadge.jsx";
import { bankAccountLabel } from "../utils/bankAccounts.js";
import { bankDisplayName } from "../../../shared/peruBanks.mjs";
const historicalSourceBanks = ["BBVA", "BCP", "INTERBANK", "SCOTIABANK"];

const amountOf = (row) => Number(row.accountsPayable?.outstandingAmount ?? row.outstandingAmount ?? row.totalAmount ?? 0);
// What goes to the supplier through BBVA: outstanding minus a pending SPOT detraccion.
const netAmountOf = (row) => Number(row.accountsPayable?.netPayableAmount ?? amountOf(row));
// A fortnightly payment day or the Wednesday urgency window: no reason needed (treasuryService).
const onPaymentCycle = (dateKey) => Boolean(dateKey) && (isPaymentCycleDate(new Date(`${dateKey}T12:00:00.000Z`)) || isUrgencyPaymentDate(new Date(`${dateKey}T12:00:00.000Z`)));
const requestIdOf = (row) => row.requestId || row.request?._id || row._id;
const payableIdOf = (row) => row.accountsPayable?._id || row._id;
const PAYMENT_VIEWS = ["prepare", "confirm", "detractions", "reconcile", "returned"];
// Accounting verifies each bank TXT before Treasury may download it and send it to the bank. A file
// generated before that control has no verification status and counts as verified.
const verificationOf = (batch) => batch?.verification?.status || "VERIFIED";
const fileReleased = (batch) => verificationOf(batch) === "VERIFIED";
const waitingReason = (batch) => verificationOf(batch) === "REJECTED" ? "Accounting rejected this bank file." : "Waiting for Accounting to verify the bank file.";

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

// The advance payable (Track C, entrega a rendir): paid the same working day, not on the cycle.
const isAdvanceRow = (row) => row?.accountsPayable?.flowType === "C" && row?.accountsPayable?.voucher?.voucherType === "ANTICIPO";

export default function TreasuryQueue({ historyOnly = false }) {
  const [paymentView, setPaymentView] = useState("prepare");
  const [searchParams, setSearchParams] = useSearchParams();
  const { t, language } = useLanguage();
  // The read-only Super Admin follows payments without acting on them.
  const { readOnly } = useAuth();
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
  const [batchDetails, setBatchDetails] = useState(null);
  const [review, setReview] = useState(null);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const generation = useRef(null);
  const [filters, setFilters] = useState({ beneficiaryBank: "", datePreset: "", paymentStatus: "", department: "", supplierSearch: "", costCenter: "", flowType: "", paymentPriority: "", creditDays: "", documentValidity: "" });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  useEffect(() => { const timer = setTimeout(() => setAppliedFilters(filters),180); return () => clearTimeout(timer); },[filters]);
  const changeFilter = (key, value) => { setFilters(current => ({ ...current, [key]: value })); setSelected([]); };
  const [result, setResult] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [paymentRow, setPaymentRow] = useState(null);
  const [paymentForm, setPaymentForm] = useState({ operationNumber: "", paidAt: todayIso(), confirmedAmount: "", comments: "" });
  const [bounceRow, setBounceRow] = useState(null);
  const [bounceForm, setBounceForm] = useState({ reason: "", reasonCategory: "", bankReference: "" });
  const [reprogramRow, setReprogramRow] = useState(null);
  const [reprogramForm, setReprogramForm] = useState({ comments: "", cciLetter: null });
  const [reconciliationRow, setReconciliationRow] = useState(null);
  const [reconciliationForm, setReconciliationForm] = useState({ bankReference: "", statementAmount: "", comments: "" });
  const [cancelTarget, setCancelTarget] = useState(null);
  const [pendingCurrency, setPendingCurrency] = useState(null);
  const [detractionRow, setDetractionRow] = useState(null);
  const [detractionForm, setDetractionForm] = useState({ constancyNumber: "", depositDate: "", amount: "" });
  // The next 15th / 30th payment run: what the payment terms (or Treasury's Excel plan) put in it.
  // "Prepare this run" lists only those payments and ticks every one that can be paid; Treasury
  // checks them and generates the bank file.
  const [nextRun, setNextRun] = useState(null);
  const [run, setRun] = useState(null);
  // Advances to render are paid the same working day: "Pay now" lists the ones due, ticks them
  // and dates the file today (no reason needed for advances).
  const [advancesDue, setAdvancesDue] = useState(null);
  const [advanceRun, setAdvanceRun] = useState(false);
  const runSelection = useRef("");

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
  // The stage lists load on /treasury only; /treasury/history loads just the file history.
  const linkOptions = { fixedParams: linkParams, deepLink: linkActive, enabled: !historyOnly };
  // The linked CXP is listed whatever its currency; the currency selector follows it (below).
  const queueTable = usePaginatedResource("/treasury/queue", { fixedParams: linkActive ? { bank, ...linkParams } : { bank, currency, ...appliedFilters, ...(advanceRun ? { advancesDue: "true" } : run ? { paymentCycle: run.date } : {}) }, persistKey: "treasury-queue", deepLink: linkActive, enabled: !historyOnly });
  const historyTable = usePaginatedResource("/treasury/bank-files", { enabled: historyOnly });
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
    const linkId = deepLink.linkKey;
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
  // Refresh spins for what is on screen, not for every stage.
  const loading = historyOnly ? historyTable.loading : stageTables[paymentView].loading;
  const resourceError = historyOnly ? historyTable.error : queueTable.error || confirmationTable.error || bouncedTable.error || reconciliationTable.error || detractionTable.error;

  function selectView(view) {
    setPaymentView(view);
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      if (view === "prepare") next.delete("tab");
      else next.set("tab", view);
      return next;
    }, { replace: true });
  }

  // A bank file holds one currency: changing it clears the selection, so ask first.
  function changeCurrency(next) {
    if (next === currency) return;
    if (selected.length) setPendingCurrency(next);
    else setCurrency(next);
  }

  function loadNextRun() {
    if (historyOnly) return;
    api.get("/treasury/next-run").then((response) => setNextRun(response.data.data || null)).catch(() => setNextRun(null));
  }
  useEffect(loadNextRun, [historyOnly]);
  function loadAdvancesDue() {
    if (historyOnly) return;
    api.get("/treasury/advances-due").then((response) => setAdvancesDue(response.data.data || null)).catch(() => setAdvancesDue(null));
  }
  useEffect(loadAdvancesDue, [historyOnly]);

  function payAdvancesNow() {
    if (!advancesDue?.count) return;
    runSelection.current = "waiting";
    setRun(null);
    setAdvanceRun(true);
    setPaymentDate(todayKey);
    setPaymentDateReason("");
    setSelected([]);
    const currencies = Object.keys(advancesDue.totalsByCurrency || {});
    if (currencies.length === 1) setCurrency(currencies[0]);
    selectView("prepare");
    queueTable.setQuery((current) => ({ ...current, page: 1, pageSize: 100, search: "", filters: {} }));
    if (advanceRun) queueTable.reload();
  }

  function prepareRun() {
    if (!nextRun?.date) return;
    runSelection.current = "waiting";
    setAdvanceRun(false);
    setRun({ date: nextRun.date });
    setPaymentDate(nextRun.date);
    setPaymentDateReason("");
    setSelected([]);
    selectView("prepare");
    queueTable.setQuery((current) => ({ ...current, page: 1, pageSize: 100, search: "", filters: {} }));
    if (run?.date === nextRun.date) queueTable.reload();
  }

  // Ticks the run's payments once its list has loaded (not the list shown before).
  useEffect(() => {
    if (!(run || advanceRun) || !runSelection.current) return;
    if (queueTable.loading) { runSelection.current = "loading"; return; }
    if (runSelection.current !== "loading") return;
    runSelection.current = "";
    const ids = queueRows.filter(isSelectable).map((row) => row.selectionKey);
    setSelected(ids);
    notify(advanceRun
      ? t("{count} advances to pay today are selected. Generate the bank file dated today.").replace("{count}", ids.length)
      : t("{count} payments of the {date} run are selected. Check them and generate the bank file.").replace("{count}", ids.length).replace("{date}", formatDate(`${run.date}T12:00:00Z`, language)), ids.length ? "success" : "info");
  }, [run, advanceRun, queueTable.loading, queueTable.rows]);

  // The advance notice and the dashboard task link here with ?advances=due.
  const advancesLinkHandled = useRef(false);
  useEffect(() => {
    if (advancesLinkHandled.current || searchParams.get("advances") !== "due" || !advancesDue) return;
    advancesLinkHandled.current = true;
    payAdvancesNow();
    setSearchParams((current) => { const next = new URLSearchParams(current); next.delete("advances"); return next; }, { replace: true });
  }, [advancesDue, searchParams]);

  // The payment-run notification links here with ?run=next.
  const runLinkHandled = useRef(false);
  useEffect(() => {
    if (runLinkHandled.current || searchParams.get("run") !== "next" || !nextRun) return;
    runLinkHandled.current = true;
    prepareRun();
    setSearchParams((current) => { const next = new URLSearchParams(current); next.delete("run"); return next; }, { replace: true });
  }, [nextRun, searchParams]);

  function reloadAll() {
    if (historyOnly) {
      historyTable.reload();
      return;
    }
    loadNextRun();
    loadAdvancesDue();
    queueTable.reload();
    confirmationTable.reload();
    bouncedTable.reload();
    reconciliationTable.reload();
    detractionTable.reload();
  }


  useEffect(() => {
    setAccountSelections((current) => {
      const next = { ...current };
      for (const row of rows) {
        const payableId = payableIdOf(row);
        const accounts = row.eligibleBankAccounts || row.activeBankAccounts || [];
        const locked = row.destinationLocked || row.paymentDestination
          ? row.paymentDestination
          : null;
        const eligible = accounts.filter((account) => account.currency === currency && (!filters.beneficiaryBank || account.bank === filters.beneficiaryBank));
        const existing = eligible.find((account) => String(account._id) === String(current[payableId]));
        // The account the requester chose comes first, then the supplier's preferred one.
        const requested = eligible.find((item) => String(item._id) === String(row.requestedAccount?.accountId || ""));
        const account = locked || existing || requested || eligible.find((item) => item.preferred) || eligible[0];
        const accountId = account?.bankAccountId || account?.employeeBankAccountId || account?._id;
        if (locked) delete next[payableId];
        else if (accountId) next[payableId] = String(accountId);
      }
      return next;
    });
  }, [rows, bank, currency, filters.beneficiaryBank]);

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
  // Bulk selection: DataTable keys the checkbox column by the CXP id, and only rows with an
  // eligible account in the file currency can be selected.
  const queueRows = useMemo(() => rows.map((row) => ({ ...row, selectionKey: String(payableIdOf(row)) })), [rows]);
  const isSelectable = (row) => !readOnly && row.paymentEligible !== false && matchingAccounts(row).length > 0;
  // Bank-file steps: 1 file details (an off-cycle date needs a reason), 2 selection, 3 review.
  const advancesOnly = Boolean(review?.advancesOnly);
  // An off-cycle date needs a typed reason, except for a file of advances only (the platform
  // records why). Step 1, the Generate button and its note all use this one rule.
  const reasonMissing = offCycle && !advancesOnly && !paymentDateReason.trim();
  // The account chosen for each selected supplier payment. An employee advance or reimbursement,
  // or a destination already frozen, is paid to its fixed destination, so no choice is sent: the
  // server refuses one. The readiness check and the file use the same selection.
  const fileAccountSelections = useMemo(() => Object.fromEntries(selected.filter(id => accountSelections[id]).map(id => [id, accountSelections[id]])), [selected, accountSelections]);

  const reviewPayload = { payableIds: selected, currency, accountSelections: fileAccountSelections, paymentDate, paymentDateReason: offCycle && paymentDateReason.trim() ? paymentDateReason : undefined };
  const reviewKey = JSON.stringify(reviewPayload);
  useEffect(() => {
    if (!selected.length) { setReview(null); return; }
    let active = true; setReview(null); setReviewBusy(true);
    const timer = setTimeout(() => api.post("/operations/payments", reviewPayload)
      .then(response => { if (active) setReview(response.data.data); })
      .catch(error => { if (active) setActionError(error.message); })
      .finally(() => { if (active) setReviewBusy(false); }), 180);
    return () => { active = false; clearTimeout(timer); };
  }, [reviewKey]);

  async function selectAllFiltered() {
    setSelectionBusy(true); setActionError("");
    try {
      const all = await queueTable.remote.fetchAll(5001);
      if (all.length > 5000) throw new Error(t("Narrow the filters to select up to 5000 payments."));
      const eligible = all.filter(row => row.paymentEligible === true && matchingAccounts(row).length > 0);
      const choices = {};
      for (const row of eligible) {
        if (row.destinationLocked || row.paymentDestination) continue;
        const account = matchingAccounts(row).find(account => !filters.beneficiaryBank || account.bank === filters.beneficiaryBank);
        if (account) choices[String(payableIdOf(row))] = String(account._id);
      }
      setAccountSelections(current => ({ ...current, ...choices }));
      setSelected(eligible.map(row => String(payableIdOf(row))));
    } catch(error) { setActionError(error.message); } finally { setSelectionBusy(false); }
  }

  // An unpaid advance switches to the employee's current verified bank account (for example after
  // the employee corrected it and Accounting verified the new one).
  async function useCurrentBankAccount(row) {
    setActionError("");
    try {
      const response = await api.post(`/treasury/payables/${payableIdOf(row)}/use-current-bank-account`);
      notify(response.data.data?.changed ? "The advance now pays to the employee's current verified bank account." : "The advance already uses the employee's current verified bank account.", response.data.data?.changed ? "success" : "info");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
    }
  }

  async function generate() {
    setProcessing(true);
    setActionError("");
    try {
      const fingerprint = JSON.stringify([bank, reviewKey]);
      if (generation.current?.fingerprint !== fingerprint) generation.current = { fingerprint, key: crypto.randomUUID() };
      const response = await api.post("/treasury/bank-file", {
        idempotencyKey: generation.current.key,
        payableIds: selected,
        bank,
        currency,
        paymentDate,
        paymentDateReason: offCycle && paymentDateReason.trim() ? paymentDateReason : undefined,
        accountSelections: fileAccountSelections
      });
      setResult(response.data);
      // The generated CXPs leave the queue; the selection is cleared so none is sent twice.
      setSelected([]);
      setActionError("");
      notify("Bank TXT instruction created. Payment remains unconfirmed.");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
      if (error.details?.issues) setReview(current => ({ ...current, ready: false, issues: error.details.issues }));
    } finally {
      setProcessing(false);
    }
  }

  function openPaymentConfirmation(row) {
    setPaymentRow(row);
    setPaymentForm({
      operationNumber: "",
      paidAt: todayIso(),
      confirmedAmount: String(netAmountOf(row)),
      comments: ""
    });
  }

  async function confirmPayment(event) {
    event.preventDefault(); if (!paymentDraft.ready || paymentDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    setActionError("");
    try {
      await api.post(`/treasury/payables/${payableIdOf(paymentRow)}/confirm-payment`, paymentForm);
      await paymentDraft.complete();
      notify("Actual bank payment confirmed; CXP was settled and the payment journal was posted.");
      celebrate("Payment sent");
      setPaymentRow(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setProcessing(false);
    }
  }

  async function reportBounce(event) {
    event.preventDefault(); if (!bounceDraft.ready || bounceDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    setActionError("");
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
    } finally {
      setProcessing(false);
    }
  }

  async function reprogramPayment(event) {
    event.preventDefault(); if (!reprogramDraft.ready || reprogramDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    setActionError("");
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

  async function cancelFile(reason) {
    setProcessing(true);
    setActionError("");
    try {
      await api.post(`/treasury/bank-files/${cancelTarget.batchId}/cancel`, { reason, accountsPayableIds: cancelTarget.accountsPayableId ? [cancelTarget.accountsPayableId] : undefined });
      notify(cancelTarget.accountsPayableId ? "The CXP was removed from the bank file and is back in the payment queue." : "Bank file cancelled. Its CXP records are back in the payment queue.");
      setCancelTarget(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
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
    setActionError("");
    try {
      await api.post(`/treasury/payables/${payableIdOf(detractionRow)}/detraction-deposit`, detractionForm);
      notify("Detraction deposit recorded.");
      setDetractionRow(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
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
    setActionError("");
    try {
      await api.post(`/treasury/payables/${payableIdOf(reconciliationRow)}/reconcile`, reconciliationForm);
      await reconciliationDraft.complete();
      notify("Payment reconciled. Request progress has been updated.");
      setReconciliationRow(null);
      setActionError("");
      reloadAll();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setProcessing(false);
    }
  }

  const reprogramLetterRequired = reprogramRow?.accountsPayable?.bouncedPayment?.reasonCategory !== "TECHNICAL";

  const queueColumns = [
    { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <div className="primary-cell"><button type="button" className="link-button" onClick={() => setQuickViewId(requestIdOf(row))}>{row.requestNumber}</button>{row.priority && <PriorityBadge priority={row.priority} />}</div> },
    { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator")}</strong><span>{row.accountsPayable?.voucher?.series ? `${row.accountsPayable.voucher.series}-${row.accountsPayable.voucher.number}` : row.accountsPayable?.supplierIdentifierSnapshot || "-"}</span></div> },
    { key: "flowType", type: "code", label: "Track", getValue: (row) => row.accountsPayable?.flowType || row.flowType, render: (row) => <StatusBadge status={row.accountsPayable?.flowType || row.flowType} /> },
    { key: "priority", label: "Priority", getValue: (row) => row.accountsPayable?.paymentPriority, render: (row) => <StatusBadge status={row.accountsPayable?.paymentPriority || "NORMAL"} /> },
    { key: "account", primary: true, minWidth: "220px", label: "Payment destination snapshot", sortable: false, render: (row) => {
      const accounts = matchingAccounts(row);
      if (row.ineligibleReason) return <span className="cell-note">{t(row.ineligibleReason)}</span>;
      // What the requester said: the supplier's account and its currency. A currency other than
      // the payment's is flagged; nothing is ever converted.
      const requested = row.requestedAccount;
      const requestedNote = requested && <small className={requested.currencyMatches ? "requested-account" : "requested-account text-danger"}>{t("Requester chose")}: {bankAccountLabel(requested, t)}{!requested.currencyMatches && ` · ${t("Currency differs from this payment")}`}</small>;
      const payableId = String(payableIdOf(row));
      const locked = row.destinationLocked || row.paymentDestination;
      if (!accounts.length) {
        // Why it cannot be selected, and the supplier record where it is fixed.
        const block = paymentBlockFor(row, currency);
        const reason = block && Object.entries(block.params).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), t(PAYMENT_BLOCK_TEXT[block.code]));
        return <div className="payment-block"><span className="blocked-inline"><AlertTriangle size={14} />{t("No eligible matching account")}</span>{reason && <small>{reason}</small>}{requestedNote}{block?.href && <Link to={block.href} onClick={(event) => event.stopPropagation()}>{t("Open the supplier's bank accounts")}</Link>}</div>;
      }
      if (locked) {
        const account = accounts[0];
        return <div className="payment-destination-summary compact"><LockKeyhole size={14} /><div><strong>{destinationBank(row)} · {account.currency}</strong><span>{account.cciMasked || account.cci || account.accountNumberMasked || account.accountNumber}</span><small>{t("Payment destination snapshot")}</small></div></div>;
      }
      const selectedId = accountSelections[payableId];
      const selectedAccount = accounts.find((account) => String(account._id) === String(selectedId)) || accounts[0];
      return <label className="table-account-select" onClick={(event) => event.stopPropagation()}><span className="sr-only">{t("Treasury Account Selection")}</span><select value={selectedId || ""} onChange={(event) => setAccountSelections((current) => ({ ...current, [payableId]: event.target.value }))}>{accounts.map((account) => <option key={account._id} value={account._id}>{String(account._id) === String(requested?.accountId || "") ? `${t("Chosen by the requester")} - ` : account.preferred ? `${t("Preferred account")} - ` : ""}{bankDisplayName(account.bank, account.bankOtherName)} · {t(account.accountType === "SAVINGS" ? "Savings account" : "Current account")} - {account.cci || account.accountNumber}</option>)}</select><small>{selectedAccount?.preferred ? <><Star size={11} />{t("Preferred account")}</> : t("Only verified eligible accounts are listed.")}</small>{requestedNote}</label>;
    } },
    { key: "status", type: "status", label: "CXP status", getValue: (row) => row.accountsPayable?.status, render: (row) => <StatusBadge status={row.accountsPayable?.status} /> },
    { key: "paymentCycle", type: "date", label: "Payment cycle", sortable: false, getValue: (row) => row.accountsPayable?.paymentCycleDate, render: (row) => row.accountsPayable?.paymentCycleDate ? <span className="primary-cell"><strong>{formatDate(`${row.accountsPayable.paymentCycleDate}T12:00:00Z`)}</strong>{row.accountsPayable?.scheduleOverride?.reason && <small>{t("Off-cycle")}: {t(row.accountsPayable.scheduleOverride.reason)}</small>}</span> : "-" },
    { key: "amount", type: "money", sortKey: "outstandingAmount", label: "Outstanding", getValue: amountOf, render: (row) => <div className="primary-cell"><strong>{money(row.accountsPayable?.currency || row.currency, amountOf(row))}</strong>{netAmountOf(row) !== amountOf(row) && <small>{t("Net transfer")}: {money(row.accountsPayable?.currency || row.currency, netAmountOf(row))}</small>}</div> },
    { key: "detraction", label: "Detraction (SPOT)", sortable: false, render: detractionCell },
    { key: "paymentTerms", label: "Payment Terms", sortable: false, getValue: (row) => paymentTermsSummary(row.accountsPayable?.paymentTermsSnapshot || row.paymentTermsSnapshot || {}, t), render: (row) => <PaymentTermsSummary terms={row.accountsPayable?.paymentTermsSnapshot || row.paymentTermsSnapshot} showAmounts={false} /> },
    { key: "scheduledPaymentDate", type: "date", primary: true, label: "Scheduled payment date", sortable: false, render: row => row.accountsPayable?.scheduledFor || row.accountsPayable?.plannedPaymentDate ? formatDate(row.accountsPayable.scheduledFor || row.accountsPayable.plannedPaymentDate, language) : "Por programar" },
    { key: "dueDate", type: "date", primary: true, label: "Due date", getValue: (row) => row.accountsPayable?.dueDate, render: (row) => row.accountsPayable?.dueDate ? formatDate(row.accountsPayable.dueDate) : row.accountsPayable?.paymentTermsSnapshot?.paymentCondition ? <span className="cell-note">{t("Date to be confirmed under the agreed terms")}</span> : "-" }
  ];

  return <section>
      <PageHeader title={historyOnly ? "Payment History" : "Payments"} description={historyOnly ? "Bank files generated for payment, with their downloads." : "Prepare the BBVA bank file, confirm what the bank paid, deposit detractions and reconcile."} actions={<>{!historyOnly && !readOnly && <ExcelImport kind="payment-schedule" onImported={reloadAll} />}<button type="button" className="secondary-button" onClick={reloadAll} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button></>} />
      <WorkspaceTools links={[["Reimbursement Banking", "/reimbursement-bank"], ["Suppliers", "/suppliers"], ["Management Reports", "/reports"]]} />
    <Message type="error">{(paymentRow || bounceRow || reprogramRow || reconciliationRow || cancelTarget || detractionRow ? "" : actionError) || resourceError}</Message>
    {linkActive && <DeepLinkNotice title="Showing the payment linked from your notification" missing={linkMissing} missingDescription="This payment is no longer pending in any Treasury stage. It may already be paid and reconciled." clearLabel="Show all payments" onClear={deepLink.clear} />}


    {historyOnly
      ? <div className="focus-tabs"><Link to="/treasury">{t("Payments")}</Link></div>
      : <Tabs idPrefix="treasury" label="Payment stages" panels value={paymentView} onChange={selectView} tabs={[["prepare", "Pending payments"], ["confirm", "Confirm payments"], ["detractions", "Detractions"], ["reconcile", "Reconciliation"], ["returned", "Returned payments"]].map(([id, label]) => ({ id, label, count: stageTotals[PAYMENT_VIEWS.indexOf(id)] }))}><Link to="/treasury/history">{t("Payment History")}</Link></Tabs>}
    <div hidden={historyOnly || paymentView !== "prepare"} {...tabPanelProps("treasury", "prepare")}>
    {advancesDue?.count > 0 && <div className={`payment-run-banner is-urgent${advanceRun ? " is-active" : ""}`} role="region" aria-label={t("Advances to pay now")}>
      <AlertTriangle size={20} aria-hidden="true" />
      <div>
        <strong>{t("Advances to pay now")}: {advancesDue.count}</strong>
        <span>{Object.entries(advancesDue.totalsByCurrency || {}).map(([code, item]) => money(code, item.total)).join(" · ")} · {t("Advances are paid the same working day, outside the fortnightly payment days.")}</span>
      </div>
      {!readOnly && (advanceRun ? <button type="button" className="text-button" onClick={() => { setAdvanceRun(false); setSelected([]); }}>{t("Show every pending payment")}</button> : <button type="button" className="secondary-button" onClick={payAdvancesNow}>{t("Pay now")}</button>)}
    </div>}
    {nextRun?.date && <div className={`payment-run-banner${run ? " is-active" : ""}`} role="region" aria-label={t("Next payment run")}>
      <CalendarClock size={20} aria-hidden="true" />
      <div>
        <strong>{t("Next payment run")}: {formatDate(`${nextRun.date}T12:00:00Z`, language)}</strong>
        <span>{nextRun.count ? `${t(nextRun.count === 1 ? "{count} payment due" : "{count} payments due").replace("{count}", nextRun.count)} · ${Object.entries(nextRun.totalsByCurrency || {}).map(([code, item]) => money(code, item.total)).join(" · ")}` : t("Nothing is due for this run yet.")}</span>
      </div>
      {!readOnly && nextRun.count > 0 && (run ? <button type="button" className="text-button" onClick={() => { setRun(null); setSelected([]); }}>{t("Show every pending payment")}</button> : <button type="button" className="secondary-button" onClick={prepareRun}>{t("Prepare this run")}</button>)}
    </div>}
    <div className="treasury-essential-filters">
      <label className="field"><span>{t("Destination bank")}</span><select value={filters.beneficiaryBank} onChange={event => changeFilter("beneficiaryBank",event.target.value)}><option value="">{t("All banks")}</option>{banks.map(code => <option key={code} value={code}>{t(code)}</option>)}</select></label>
      <label className="field"><span>{t("Payment period")}</span><select value={filters.datePreset} onChange={event => changeFilter("datePreset",event.target.value)}>{[["","All dates"],["today","Today"],["next7","Next 7 days"],["next15","Next 15 days"],["month","This month"],["custom","Custom range"]].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      <label className="field"><span>{t("Status")}</span><select value={filters.paymentStatus} onChange={event => changeFilter("paymentStatus",event.target.value)}>{[["","All pending"],["ready","Ready for payment"],["pending","Pending preparation"],["dueSoon","Due soon"],["overdue","Overdue"]].map(([value,label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
      <label className="field"><span>{t("Currency")}</span><select value={currency} onChange={event => changeCurrency(event.target.value)}><option value="PEN">PEN</option><option value="USD">USD</option></select></label>
      {filters.datePreset === "custom" && <><label className="field"><span>{t("From")}</span><DateInput value={filters.dateFrom || ""} onChange={event => changeFilter("dateFrom",event.target.value)} /></label><label className="field"><span>{t("To")}</span><DateInput value={filters.dateTo || ""} onChange={event => changeFilter("dateTo",event.target.value)} /></label></>}
    </div>
    <details className="section-spacer"><summary>{t("More filters")}</summary><div className="treasury-essential-filters">
      {[ ["supplierSearch","Supplier"], ["department","Department"], ["costCenter","Cost center"], ["creditDays","Credit days"] ].map(([key,label]) => <label className="field" key={key}><span>{t(label)}</span><input type={key === "creditDays" ? "number" : "text"} min="0" value={filters[key]} onChange={event => changeFilter(key,event.target.value)} /></label>)}
      <label className="field"><span>{t("Track")}</span><select value={filters.flowType} onChange={event => changeFilter("flowType",event.target.value)}><option value="">{t("All tracks")}</option>{flowTypes.map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="field"><span>{t("Priority")}</span><select value={filters.paymentPriority} onChange={event => changeFilter("paymentPriority",event.target.value)}><option value="">{t("All priorities")}</option><option value="PRIORITY">{t("PRIORITY")}</option><option value="NORMAL">{t("NORMAL")}</option></select></label>
      <label className="field"><span>{t("Document validity")}</span><select value={filters.documentValidity} onChange={event => changeFilter("documentValidity",event.target.value)}><option value="">{t("All documents")}</option><option value="valid">{t("Valid")}</option><option value="exception">{t("Manual exception")}</option></select></label>
    </div></details>

    {result && <div className="success-result" role="status"><div><strong>{t("Bank instruction generated")}</strong><span>{result.fileName} · {result.notice}</span></div><span className="cell-note">{t("Sent to Accounting for verification. You can download it from Payment History once it is verified.")}</span></div>}

    <div className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Select payments")}</h3><p>{t("Only payments with a verified account in the file currency can be selected.")}</p></div></div><DataTable detailSteps={paymentSteps} rows={queueRows} rowKey="selectionKey" emptyTitle="No payments pending" emptyDescription="Approved CXP records appear here when they are ready to be paid." emptyAction={{ label: "Payment History", to: "/treasury/history" }} selection={{ selected, onChange: setSelected, isRowSelectable: isSelectable }} toolbarActions={readOnly ? undefined : <button type="button" className="secondary-button" disabled={selectionBusy || queueTable.loading || JSON.stringify(filters) !== JSON.stringify(appliedFilters) || !queueTable.pagination.total} onClick={selectAllFiltered}><ListChecks size={16} /><span>{t(selectionBusy ? "Selecting..." : "Select all filtered eligible")}</span></button>} loading={queueTable.loading} remote={queueTable.remote}  searchPlaceholder="Search request, supplier, voucher, or cost center..." rowActions={(row) => [{ label: "Open request", icon: Eye, onClick: () => setQuickViewId(requestIdOf(row)) }, { label: "Use current bank account", icon: RefreshCw, hidden: readOnly || !isAdvanceRow(row) || row.accountsPayable?.status !== "OPEN", onClick: () => useCurrentBankAccount(row) }]} columns={queueColumns} />
    {selected.length > 0 && <div className="workspace-panel section-spacer" role="region" aria-label={t("Review and generate")}>
      <div className="section-heading"><h3>{t("Review and generate")}</h3><button type="button" className="text-button" onClick={() => setSelected([])}>{t("Clear selection")}</button></div>
      <p>{t("Selected payables")}: {selected.length}</p>
      <PaymentBatchSummary summary={review?.summary} bank={bank} currency={currency} />
      <div className="filter-row"><label className="field"><span>{t("Scheduled payment date")}</span><DateInput min={todayKey} value={paymentDate} onChange={event => setPaymentDate(event.target.value)} /></label>{offCycle && !advancesOnly && <label className="field"><span>{t("Reason for paying off the payment cycle")}</span><input value={paymentDateReason} onChange={event => setPaymentDateReason(event.target.value)} /></label>}</div>
      {reviewBusy && <p role="status">{t("Checking...")}</p>}
      {review?.issues?.length > 0 && <div role="alert"><strong>{t("Correct or exclude these payments")}</strong>{review.issues.map((issue,index) => <p key={index}>{t(issue.message)} {issue.id && <button type="button" className="text-button" onClick={() => setSelected(current => current.filter(id => id !== issue.id))}>{t("Exclude")}</button>}</p>)}</div>}
      {review?.ready && <p className="cell-note">{t("Invoice references remain separate in the BBVA TXT. The summary groups compatible destinations.")}</p>}
      <button type="button" className="primary-button" disabled={processing || reviewBusy || !review?.ready || reasonMissing} onClick={generate}><FileDown size={16} /><span>{t("Generate TXT")}</span></button>
    </div>}

    </div>

    </div>
    <div hidden={historyOnly || paymentView !== "confirm"} {...tabPanelProps("treasury", "confirm")} id="treasury-confirm" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Payment confirmation")}</h3><p>{t("Confirm the item or report the bank rejection. A rejected item becomes PAGO_REBOTADO without cancelling other invoices in the same request.")}</p></div><span className="section-count">{confirmationTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={confirmationTable.rows} loading={confirmationTable.loading} remote={confirmationTable.remote} emptyTitle="No payments to confirm" emptyDescription="Payments appear here after their bank file is generated." emptyAction={{ label: "Pending payments", onClick: () => selectView("prepare") }} rowActions={(row) => readOnly ? [] : [{ label: "Confirm payment", icon: CircleCheckBig, primary: true, disabled: !fileReleased(row.accountsPayable?.paymentBatch), disabledReason: fileReleased(row.accountsPayable?.paymentBatch) ? undefined : waitingReason(row.accountsPayable?.paymentBatch), onClick: () => openPaymentConfirmation(row) }, { label: "Report bounced payment", icon: XCircle, disabled: !fileReleased(row.accountsPayable?.paymentBatch), disabledReason: fileReleased(row.accountsPayable?.paymentBatch) ? undefined : waitingReason(row.accountsPayable?.paymentBatch), onClick: () => { setBounceRow(row); setBounceForm({ reason: "", reasonCategory: "", bankReference: "" }); } }, { label: "Remove from bank file", icon: Ban, tone: "danger", disabled: row.accountsPayable?.status !== "PAYMENT_FILE_CREATED", disabledReason: row.accountsPayable?.status === "PAYMENT_FILE_CREATED" ? undefined : "Only possible before any payment of this file is confirmed.", onClick: () => { setCancelTarget({ batchId: row.accountsPayable?.paymentBatch?._id, batchNumber: row.accountsPayable?.paymentBatch?.batchNumber, accountsPayableId: payableIdOf(row) }); } }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator") },
      { key: "flowType", type: "code", label: "Track", render: (row) => <StatusBadge status={row.accountsPayable?.flowType || row.flowType} /> },
      { key: "batch", type: "code", label: "Bank batch", sortable: false, render: (row) => <span className="primary-cell"><span>{`${row.accountsPayable?.paymentBatch?.batchNumber || "-"} / ${row.accountsPayable?.paymentBatch?.bank || "-"}`}</span>{!fileReleased(row.accountsPayable?.paymentBatch) && <small>{t(waitingReason(row.accountsPayable?.paymentBatch))}</small>}</span> },
      { key: "status", type: "status", label: "CXP status", render: (row) => <StatusBadge status={row.accountsPayable?.status} /> },
      { key: "amount", type: "money", label: "Amount", getValue: netAmountOf, render: (row) => <strong>{money(row.accountsPayable?.currency || row.currency, netAmountOf(row))}</strong> },
      { key: "detraction", label: "Detraction (SPOT)", sortable: false, render: detractionCell }
    ]} /></div>

    <div hidden={historyOnly || paymentView !== "detractions"} {...tabPanelProps("treasury", "detractions")} id="treasury-detractions" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Detraction deposits")}</h3><p>{t("Deposit the SPOT detraction in the supplier's Banco de la Nación account and record the constancia. The CXP is fully paid only after the net transfer and this deposit.")}</p></div><span className="section-count">{detractionTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={detractionTable.rows} loading={detractionTable.loading} remote={detractionTable.remote} rowActions={(row) => readOnly ? [] : [{ label: "Record detraction deposit", icon: Landmark, disabled: !row.detractionAccountRegistered, disabledReason: row.detractionAccountRegistered ? undefined : "The supplier has no Banco de la Nación detracciones account.", onClick: () => openDetraction(row) }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${row.requestId}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || "-" },
      { key: "category", type: "code", primary: true, label: "SPOT category", sortable: false, render: (row) => `${row.detraction?.categoryCode || "-"} · ${row.detraction?.rate ?? "-"}%` },
      { key: "account", label: "Banco de la Nación account", sortable: false, render: (row) => row.detractionAccountRegistered ? `****${row.detractionAccountLast4}` : <span className="blocked-inline"><AlertTriangle size={14} />{t("Missing")}</span> },
      { key: "netTransfer", type: "money", label: "Net transfer pending", sortable: false, render: (row) => money(row.currency, row.netTransferPending) },
      { key: "amount", type: "money", label: "Detraction", sortable: false, render: (row) => <strong>{money("PEN", row.detraction?.amountPen)}</strong> }
    ]} /></div>

    <div hidden={historyOnly || paymentView !== "returned"} {...tabPanelProps("treasury", "returned")} id="treasury-returned" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Bounced payment reprogramming")}</h3><p>{t("A signed CCI letter is required when the bank rejected the beneficiary's bank details. A technical rejection on a verified account can be retried without a new letter.")}</p></div><span className="section-count">{bouncedTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={bouncedTable.rows} loading={bouncedTable.loading} remote={bouncedTable.remote} rowActions={(row) => readOnly ? [] : [{ label: row.accountsPayable?.bouncedPayment?.reasonCategory === "TECHNICAL" ? "Retry payment" : "Upload CCI letter and reprogram", icon: RotateCcw, onClick: () => { setReprogramRow(row); setReprogramForm({ comments: "", cciLetter: null }); } }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", sortable: false, render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator") },
      { key: "reason", primary: true, label: "Bank rejection", sortable: false, render: (row) => <div className="primary-cell"><strong>{row.accountsPayable?.bouncedPayment?.reason || "-"}</strong><span>{t(row.accountsPayable?.bouncedPayment?.reasonCategory || "BANK_DETAILS")} · {row.accountsPayable?.bouncedPayment?.bankReference || "-"}</span></div> },
      { key: "status", type: "status", label: "Status", render: (row) => <StatusBadge status={row.accountsPayable?.status || "PAYMENT_BOUNCED"} /> },
      { key: "amount", type: "money", label: "Outstanding", render: (row) => <strong>{money(row.currency, amountOf(row))}</strong> }
    ]} /></div>

    <div hidden={historyOnly || paymentView !== "reconcile"} {...tabPanelProps("treasury", "reconcile")} id="treasury-reconcile" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Reconciliation")}</h3><p>{t("Match all confirmed CXP payments to the bank statement before Accounting closure.")}</p></div><span className="section-count">{reconciliationTable.pagination.total}</span></div><DataTable detailSteps={paymentSteps} rows={reconciliationTable.rows} loading={reconciliationTable.loading} remote={reconciliationTable.remote} emptyTitle="Nothing to reconcile" emptyDescription="Confirmed payments appear here until they are matched to the bank statement." emptyAction={{ label: "Confirm payments", onClick: () => selectView("confirm") }} rowActions={(row) => readOnly ? [] : [{ label: "Reconcile payment", icon: Scale, onClick: () => openReconciliation(row) }]} columns={[
      { key: "requestNumber", type: "code", label: "Request", render: (row) => <Link to={`/requests/${requestIdOf(row)}`}>{row.requestNumber}</Link> },
      { key: "supplier", type: "name", label: "Supplier", sortable: false, render: (row) => row.supplier?.legalName || row.supplier?.name || row.requester?.name || t("UMA collaborator") },
      { key: "voucher", type: "code", primary: true, label: "Voucher", sortable: false, render: (row) => [row.accountsPayable?.voucher?.series, row.accountsPayable?.voucher?.number].filter(Boolean).join("-") || "-" },
      { key: "operation", type: "code", label: "Operation number", render: (row) => row.payment?.operationNumber || "-" },
      { key: "paidAt", type: "date", primary: true, label: "Paid date", render: (row) => row.payment?.paidAt ? formatDate(row.payment.paidAt) : "-" },
      { key: "status", type: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "amount", type: "money", label: "Confirmed", render: (row) => <strong>{money(row.currency, row.payment?.confirmedAmount)}</strong> }
    ]} /></div>

    <div hidden={!historyOnly} id="treasury-history" className="workspace-panel section-spacer"><div className="section-heading"><div><h3>{t("Generated bank-file history")}</h3><p>{t("Download a payment file once Accounting has verified it, then send it to the bank.")}</p></div></div><DataTable rows={historyTable.rows} loading={historyTable.loading} remote={historyTable.remote} emptyTitle="No bank files yet" emptyDescription="Bank files generated from the payment queue are kept here." emptyAction={{ label: "Payments", to: "/treasury" }} rowActions={(row) => [{ label: "View summary", icon: Eye, onClick: () => setBatchDetails(row) }, ...(!readOnly ? [{ label: "Cancel bank file", icon: Ban, tone: "danger", hidden: row.status !== "GENERATED" || (row.items || []).some((item) => ["CONFIRMED", "PARTIALLY_CONFIRMED"].includes(item.status)), onClick: () => { setCancelTarget({ batchId: row._id, batchNumber: row.batchNumber }); } }] : [])]} filters={[{ key: "bank", label: "banks", allLabel: "All banks", options: historicalSourceBanks }, { key: "currency", label: "currencies", allLabel: "All currencies", options: ["PEN", "USD"] }]} columns={[
      { key: "batchNumber", type: "code", label: "Batch" },
      { key: "fileName", type: "name", label: "File" },
      { key: "bank", type: "code", primary: true, label: "Bank" },
      { key: "currency", type: "code", label: "Currency" },
      { key: "suppliers", type: "number", label: "Suppliers", sortable: false, render: row => row.summary?.supplierCount || 0 },
      { key: "requests", type: "number", label: "Requests", sortable: false, render: row => row.summary?.requestCount || 0 },
      { key: "totalAmount", type: "money", label: "Total", render: (row) => money(row.currency, row.totalAmount) },
      { key: "status", type: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "verification", type: "status", label: "Accounting verification", sortable: false, getValue: verificationOf, render: (row) => <span className="primary-cell"><StatusBadge status={verificationOf(row)} />{row.verification?.reason && <small>{row.verification.reason}</small>}</span> },
      { key: "generatedAt", type: "date", primary: true, label: "Generated", render: row => <span className="primary-cell"><span>{formatDateTime(row.generatedAt, language)}</span><small>{row.generatedBy?.name || "—"}</small></span> },
      { key: "download", label: "Download", sortable: false, exportable: false, render: (row) => fileReleased(row)
        ? <ProtectedAssetButton className="icon-button" resourcePath={row.url} fileName={row.fileName} title="Download" ariaLabel={`${t("Download")}: ${row.fileName}`}><Download size={16} aria-hidden="true" /></ProtectedAssetButton>
        : <button type="button" className="icon-button" disabled title={t(waitingReason(row))} aria-label={`${t("Download")}: ${row.fileName} - ${t(waitingReason(row))}`}><LockKeyhole size={16} aria-hidden="true" /></button> }
    ]} /></div>

    <Drawer open={Boolean(batchDetails)} title={batchDetails?.batchNumber || "Bank file"} onClose={() => setBatchDetails(null)}>{batchDetails && <><p>{formatDateTime(batchDetails.generatedAt, language)} · {batchDetails.generatedBy?.name || "—"}</p><StatusBadge status={batchDetails.status} /><PaymentBatchSummary summary={batchDetails.summary} bank={batchDetails.bank} currency={batchDetails.currency} expanded /><PaymentSummaryDownload batch={batchDetails} />{fileReleased(batchDetails) && <ProtectedAssetButton resourcePath={batchDetails.url} fileName={batchDetails.fileName}>{t("Download TXT")}</ProtectedAssetButton>}</>}</Drawer>
    <RequestQuickView requestId={quickViewId} onClose={() => setQuickViewId(null)} />
    <ConfirmDialog open={Boolean(pendingCurrency)} title="Change the file currency?" description="A bank file holds one currency, so the selected payments are cleared." details={[{ label: "Selected CXP", value: selected.length }, { label: "New currency", value: pendingCurrency || "" }]} confirmLabel="Change currency" cancelLabel="Keep selection" onClose={() => setPendingCurrency(null)} onConfirm={() => { setCurrency(pendingCurrency); setSelected([]); setPendingCurrency(null); }} />

    <Drawer open={Boolean(paymentRow)} error={actionError} title="Confirm actual bank payment" description={paymentRow ? `${paymentRow.requestNumber} - ${paymentRow.supplier?.legalName || paymentRow.supplier?.name || t("UMA collaborator")}` : ""} onClose={() => !processing && setPaymentRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setPaymentRow(null)}>{t("Cancel")}</button><button type="submit" form="payment-confirmation-form" className="primary-button" disabled={processing}><CircleCheckBig size={16} />{t(processing ? "Processing..." : "Confirm payment")}</button></>}><div className="document-requirement required"><AlertTriangle size={20} /><div><strong>{t("This settles the selected Accounts Payable record")}</strong><p>{t("Confirmation posts the payment journal and does not infer payment from a downloaded TXT. Enter less than the outstanding amount to record a partial payment; the remaining balance stays open for a later confirmation.")}</p></div></div><DraftPanel busy={processing} draft={paymentDraft} onDiscard={() => setPaymentRow(null)}><form id="payment-confirmation-form" className="form-grid" onSubmit={confirmPayment}><label className="field"><span>{t("Operation number")} *</span><input required value={paymentForm.operationNumber} onChange={(event) => setPaymentForm({ ...paymentForm, operationNumber: event.target.value })} /></label><label className="field"><span>{t("Actual payment date")} *</span><DateInput required value={paymentForm.paidAt} onChange={(event) => setPaymentForm({ ...paymentForm, paidAt: event.target.value })} /></label><label className="field"><span>{t("Confirmed amount")} *</span><input required type="number" min="0.01" max={paymentRow ? amountOf(paymentRow) : undefined} step="0.01" value={paymentForm.confirmedAmount} onChange={(event) => setPaymentForm({ ...paymentForm, confirmedAmount: event.target.value })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={paymentForm.comments} onChange={(event) => setPaymentForm({ ...paymentForm, comments: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(bounceRow)} error={actionError} title="Report bounced payment" description={bounceRow?.requestNumber || ""} onClose={() => !processing && setBounceRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setBounceRow(null)}>{t("Cancel")}</button><button type="submit" form="bounce-payment-form" className="danger-button" disabled={processing}><XCircle size={16} />{t("Mark PAGO_REBOTADO")}</button></>}><DraftPanel busy={processing} draft={bounceDraft} onDiscard={() => setBounceRow(null)}><form id="bounce-payment-form" className="form-grid" onSubmit={reportBounce}><label className="field"><span>{t("Rejection type")} *</span><select required value={bounceForm.reasonCategory} onChange={(event) => setBounceForm({ ...bounceForm, reasonCategory: event.target.value })}><option value="">{t("Select")}</option><option value="BANK_DETAILS">{t("Incorrect, invalid, changed or unverified bank details")}</option><option value="TECHNICAL">{t("Technical or temporary bank problem")}</option></select><small className="field-hint">{t("Bank-details rejections flag the account until Accounting re-verifies it and need a signed CCI letter.")}</small></label><label className="field"><span>{t("Bank rejection reason")} *</span><textarea required rows="4" value={bounceForm.reason} onChange={(event) => setBounceForm({ ...bounceForm, reason: event.target.value })} /></label><label className="field"><span>{t("Bank reference")}</span><input value={bounceForm.bankReference} onChange={(event) => setBounceForm({ ...bounceForm, bankReference: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(reprogramRow)} error={actionError} title="Reprogram bounced payment" description={reprogramRow?.requestNumber || ""} onClose={() => !processing && setReprogramRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReprogramRow(null)}>{t("Cancel")}</button><button type="submit" form="reprogram-payment-form" className="primary-button" disabled={processing || (reprogramLetterRequired && !reprogramForm.cciLetter)}><RotateCcw size={16} />{t("Reprogram")}</button></>}><div className={`document-requirement${reprogramLetterRequired ? " required" : ""}`}><UploadCloud size={20} /><div><strong>{t(reprogramLetterRequired ? "Signed CCI letter required" : "Retry on the verified account")}</strong><p>{t(reprogramLetterRequired ? "The previous payment destination remains auditable; the replacement evidence is stored before reopening the CXP." : "The bank rejected the transfer for a technical reason. No new CCI letter is needed while the account stays verified.")}</p></div></div><DraftPanel busy={processing} draft={reprogramDraft} onDiscard={() => setReprogramRow(null)}><form id="reprogram-payment-form" className="form-grid" onSubmit={reprogramPayment}><label className="field"><span>{t("Signed CCI letter")}{reprogramLetterRequired ? " *" : ""} {reprogramForm.cciLetter?.name}</span><input required={reprogramLetterRequired && !reprogramForm.cciLetter} type="file" accept=".pdf,.png,.jpg,.jpeg" onChange={(event) => setReprogramForm({ ...reprogramForm, cciLetter: event.target.files?.[0] || null })} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reprogramForm.comments} onChange={(event) => setReprogramForm({ ...reprogramForm, comments: event.target.value })} /></label></form></DraftPanel></Drawer>

    <Drawer open={Boolean(reconciliationRow)} error={actionError} title="Reconcile bank payment" description={reconciliationRow?.requestNumber || ""} onClose={() => !processing && setReconciliationRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReconciliationRow(null)}>{t("Cancel")}</button><button type="submit" form="reconciliation-form" className="primary-button" disabled={processing}><Scale size={16} />{t(processing ? "Processing..." : "Reconcile")}</button></>}><DraftPanel busy={processing} draft={reconciliationDraft} onDiscard={() => setReconciliationRow(null)}><form id="reconciliation-form" className="form-grid" onSubmit={reconcile}><label className="field"><span>{t("Bank reference")} *</span><input required value={reconciliationForm.bankReference} onChange={(event) => setReconciliationForm({ ...reconciliationForm, bankReference: event.target.value })} /></label><label className="field"><span>{t("Statement amount")} *</span><input required type="number" min="0.01" step="0.01" value={reconciliationForm.statementAmount} onChange={(event) => setReconciliationForm({ ...reconciliationForm, statementAmount: event.target.value })} /><small className="field-hint">{t("Type the amount shown on the bank statement.")}</small></label><label className="field"><span>{t("Comments")}</span><textarea rows="4" value={reconciliationForm.comments} onChange={(event) => setReconciliationForm({ ...reconciliationForm, comments: event.target.value })} /></label></form></DraftPanel></Drawer>

    <ConfirmDialog open={Boolean(cancelTarget)} title={cancelTarget?.accountsPayableId ? "Remove from bank file?" : "Cancel bank file?"} description="Only before any payment is confirmed. The CXP records return to the payment queue. This is not a bounce and needs no CCI letter; do not upload the cancelled file to the bank." details={cancelTarget ? [{ label: "Bank batch", value: cancelTarget.batchNumber || "-" }] : []} confirmLabel={cancelTarget?.accountsPayableId ? "Remove from bank file" : "Cancel bank file"} cancelLabel="Keep bank file" tone="danger" inputLabel="Cancellation reason" inputRequired loading={processing} error={actionError} onClose={() => !processing && setCancelTarget(null)} onConfirm={cancelFile} />

    <Drawer open={Boolean(detractionRow)} error={actionError} title="Record detraction deposit" description={detractionRow ? `${detractionRow.requestNumber} - ${money("PEN", detractionRow.detraction?.amountPen)}` : ""} onClose={() => !processing && setDetractionRow(null)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setDetractionRow(null)}>{t("Cancel")}</button><button type="submit" form="detraction-deposit-form" className="primary-button" disabled={processing}><Landmark size={16} />{t("Record deposit")}</button></>}><form id="detraction-deposit-form" className="form-grid" onSubmit={depositDetraction}><label className="field"><span>{t("Constancia number")} *</span><input required value={detractionForm.constancyNumber} onChange={(event) => setDetractionForm({ ...detractionForm, constancyNumber: event.target.value })} /></label><label className="field"><span>{t("Deposit date")} *</span><DateInput required max={todayKey} value={detractionForm.depositDate} onChange={(event) => setDetractionForm({ ...detractionForm, depositDate: event.target.value })} /></label><label className="field"><span>{t("Deposited amount (PEN)")} *</span><input required type="number" min="1" step="1" value={detractionForm.amount} onChange={(event) => setDetractionForm({ ...detractionForm, amount: event.target.value })} /><small className="field-hint">{t("Whole soles, as on the constancia: SPOT deposits are rounded to the sol.")}</small></label></form></Drawer>
  </section>;
}
