import { ArrowRightLeft, CircleCheckBig, ExternalLink, Landmark, Pencil, PanelTop, Plus, Power, RefreshCw, Scale, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import DateInput from "../components/DateInput.jsx";
import DeepLinkNotice from "../components/DeepLinkNotice.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import PriorityBadge from "../components/PriorityBadge.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import Tabs from "../components/Tabs.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import useDeepLink from "../hooks/useDeepLink.js";
import { canonicalRequestStatus } from "../../../shared/workflowStatus.mjs";
import { limaDateKey } from "../../../shared/businessCalendar.mjs";
import { SELECTABLE_PERU_BANKS, bankDisplayName } from "../../../shared/peruBanks.mjs";
import { currencies, requestPriorities, requestPriorityLabels, transferPurposeLabels, treasuryAccountKindLabels } from "../utils/options.js";
import { formatCurrency, formatDate } from "../utils/formatters.js";
import { TIER_ROLES, transferRoute, transferStageLabels, transferStages } from "../utils/treasuryTransfer.js";
import { PERMISSIONS, userCan } from "../utils/access.js";

// Track D: transfers between UMA's own bank accounts in the same currency (funding an operating
// account, or a placement). Treasury registers them here; another Treasury user (Head of Treasury)
// and the GAF approve them from the Approvals inbox; Treasury executes them at the bank and
// reconciles them with the statement. The GAF and Accounting read this page.
const emptyTransfer = { sourceAccount: "", destinationAccount: "", amount: "", purpose: "FUNDING", priority: "ALTA", description: "", justification: "", instrument: "", reference: "" };
const emptyAccount = { code: "", bank: "BBVA", currency: "PEN", accountNumber: "", cci: "", ledgerAccount: "", kind: "OPERATING", description: "", active: true };
// Own accounts are held at a bank of the SBS list (no "Otro").
const accountBanks = SELECTABLE_PERU_BANKS.filter((bank) => !bank.other);
const idOf = (value) => String(value?._id || value || "");

function accountLabel(account) {
  return `${account.code} · ${bankDisplayName(account.bank)} · ${account.currency} ${account.accountNumber}`;
}

// Browser checks that mirror the backend's (models/TreasuryBankAccount.js); "" when valid.
function accountProblem(form) {
  if (!/^[A-Z0-9-]{2,30}$/.test(form.code)) return "Use a code of 2 to 30 capital letters, digits or hyphens, e.g. BBVA-PEN.";
  if (!form.accountNumber.trim()) return "Enter the account number.";
  if (form.cci && !/^\d{20}$/.test(form.cci)) return "CCI must contain exactly 20 digits.";
  if (!/^10\d{2,6}$/.test(form.ledgerAccount)) return "The ledger account is a class 10 account of 4 to 8 digits, e.g. 104101.";
  return "";
}

export default function TreasuryTransfers() {
  const { user, readOnly } = useAuth();
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const navigate = useNavigate();
  // Treasury and Admin register, execute and reconcile; everyone else (GAF, Accounting, the
  // read-only overseers) only looks.
  const canManage = !readOnly && userCan(user, PERMISSIONS.TREASURY_TRANSFER);
  const deepLink = useDeepLink(["request"]);
  const [stage, setStage] = useState(() => (deepLink.active ? "all" : canManage ? "toExecute" : "pending"));
  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [accounts, setAccounts] = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const [creating, setCreating] = useState(false);
  const [transferForm, setTransferForm] = useState(emptyTransfer);
  const [executeRow, setExecuteRow] = useState(null);
  const [executeForm, setExecuteForm] = useState({ operationNumber: "", executedAt: "", comments: "" });
  const [reconcileRow, setReconcileRow] = useState(null);
  const [reconcileForm, setReconcileForm] = useState({ bankReference: "", statementAmount: "", comments: "" });
  const [resubmitRow, setResubmitRow] = useState(null);
  const [resubmitForm, setResubmitForm] = useState({ amount: "", description: "", comments: "" });
  const [accountForm, setAccountForm] = useState(null);
  const [toggleAccount, setToggleAccount] = useState(null);
  const money = (value, currency) => formatCurrency(Number(value || 0), currency || "PEN", language);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const params = { pageSize: 100, ...deepLink.link, ...(stage !== "all" && !deepLink.active ? { stage } : {}) };
    api.get("/treasury/transfers", { params })
      .then((response) => {
        if (!active) return;
        setRows(response.data.data || []);
        setSummary(response.data.summary || {});
        setError("");
      })
      .catch((err) => active && setError(err.message))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [stage, deepLink.linkKey, revision]);

  function loadAccounts() {
    setAccountsLoading(true);
    api.get("/treasury/accounts", { params: { includeInactive: true } })
      .then((response) => { setAccounts(response.data.data || []); setAccountsError(""); })
      .catch((err) => setAccountsError(err.message))
      .finally(() => setAccountsLoading(false));
  }
  useEffect(loadAccounts, []);

  const reload = () => setRevision((value) => value + 1);
  const activeAccounts = useMemo(() => accounts.filter((account) => account.active !== false), [accounts]);
  const source = activeAccounts.find((account) => idOf(account) === transferForm.sourceAccount);
  // The destination is another active account in the source's currency: a transfer never converts.
  const destinations = source ? activeAccounts.filter((account) => idOf(account) !== idOf(source) && account.currency === source.currency) : [];

  // A notification link (?request=<id>) opens the action that transfer is waiting for.
  const openedLink = useRef("");
  useEffect(() => {
    const row = deepLink.link.request && rows.find((item) => idOf(item) === deepLink.link.request);
    if (!row || openedLink.current === deepLink.link.request || !canManage) return;
    openedLink.current = deepLink.link.request;
    const status = canonicalRequestStatus(row.status);
    if (status === "APROBADO") openExecute(row);
    if (status === "PAGADO") openReconcile(row);
  }, [deepLink.link.request, rows]);
  useEffect(() => {
    const row = deepLink.link.request && rows.find((item) => idOf(item) === deepLink.link.request);
    if (row && openedLink.current !== `resubmit:${deepLink.link.request}` && canResubmit(row)) {
      openedLink.current = `resubmit:${deepLink.link.request}`;
      openResubmit(row);
    }
  }, [deepLink.link.request, rows]);

  function changeSource(value) {
    const next = activeAccounts.find((account) => idOf(account) === value);
    const keep = next && transferForm.destinationAccount !== value && activeAccounts.some((account) => idOf(account) === transferForm.destinationAccount && account.currency === next.currency);
    setTransferForm({ ...transferForm, sourceAccount: value, destinationAccount: keep ? transferForm.destinationAccount : "" });
  }

  async function run(action, done) {
    setProcessing(true);
    setActionError("");
    try {
      await action();
      done();
      reload();
    } catch (err) {
      setActionError(err.message);
    } finally {
      setProcessing(false);
    }
  }

  function submitTransfer(event) {
    event.preventDefault();
    const amount = Number(transferForm.amount);
    if (!(amount > 0)) return setActionError(t("Enter the amount to transfer."));
    const investment = transferForm.purpose === "INVESTMENT";
    const body = {
      sourceAccount: transferForm.sourceAccount,
      destinationAccount: transferForm.destinationAccount,
      amount,
      purpose: transferForm.purpose,
      priority: transferForm.priority,
      description: transferForm.description.trim(),
      ...(transferForm.justification.trim() && { justification: transferForm.justification.trim() }),
      ...(investment && transferForm.instrument.trim() && { instrument: transferForm.instrument.trim() }),
      ...(investment && transferForm.reference.trim() && { reference: transferForm.reference.trim() })
    };
    run(async () => {
      const response = await api.post("/treasury/transfers", body);
      notify(`${t("Transfer registered and sent for approval.")} ${response.data.data?.requestNumber || ""}`.trim());
    }, () => { setCreating(false); setTransferForm(emptyTransfer); });
  }

  function openExecute(row) {
    setActionError("");
    setExecuteForm({ operationNumber: "", executedAt: limaDateKey(new Date()), comments: "" });
    setExecuteRow(row);
  }

  function openReconcile(row) {
    setActionError("");
    setReconcileForm({ bankReference: row.treasuryTransfer?.operationNumber || "", statementAmount: String(row.totalAmount ?? ""), comments: "" });
    setReconcileRow(row);
  }

  function submitExecute(event) {
    event.preventDefault();
    run(async () => {
      await api.post(`/treasury/transfers/${executeRow._id}/execute`, { operationNumber: executeForm.operationNumber.trim(), executedAt: executeForm.executedAt, ...(executeForm.comments.trim() && { comments: executeForm.comments.trim() }) });
      notify("Transfer executed. Reconcile it when it shows on the bank statement.");
    }, () => setExecuteRow(null));
  }

  // A transfer sent back by an approver: its requester (or Admin) corrects it and sends it again.
  const canResubmit = (row) => !readOnly && ["OBSERVADO", "DEVUELTO"].includes(canonicalRequestStatus(row.status)) && idOf(row.requester) === idOf(user._id);
  const sentBackComment = (row) => row?.rejectionReason || [...(row?.approvalHistory || [])].reverse().find((event) => event.comments && /OBSERV|RETURN/.test(event.action || ""))?.comments || "";

  function openResubmit(row) {
    setActionError("");
    setResubmitForm({ amount: String(row.totalAmount ?? ""), description: row.description || row.title || "", comments: "" });
    setResubmitRow(row);
  }

  function submitResubmit(event) {
    event.preventDefault();
    const amount = Number(resubmitForm.amount);
    if (!(amount > 0)) return setActionError(t("Enter the amount to transfer."));
    run(async () => {
      await api.post(`/treasury/transfers/${resubmitRow._id}/resubmit`, { amount, description: resubmitForm.description.trim(), ...(resubmitForm.comments.trim() && { comments: resubmitForm.comments.trim() }) });
      notify("Transfer corrected and sent for approval again.");
    }, () => setResubmitRow(null));
  }

  const statementDiffers = reconcileRow && reconcileForm.statementAmount !== "" && Math.abs(Number(reconcileForm.statementAmount) - Number(reconcileRow.totalAmount || 0)) > 0.004;
  function submitReconcile(event) {
    event.preventDefault();
    if (statementDiffers && !reconcileForm.comments.trim()) return setActionError(t("The statement amount differs from the transfer: explain the difference."));
    run(async () => {
      await api.post(`/treasury/transfers/${reconcileRow._id}/reconcile`, {
        ...(reconcileForm.bankReference.trim() && { bankReference: reconcileForm.bankReference.trim() }),
        ...(reconcileForm.statementAmount !== "" && { statementAmount: Number(reconcileForm.statementAmount) }),
        ...(reconcileForm.comments.trim() && { comments: reconcileForm.comments.trim() })
      });
      notify("Transfer reconciled and closed.");
    }, () => setReconcileRow(null));
  }

  function openAccount(account) {
    setActionError("");
    setAccountForm(account
      ? { _id: account._id, code: account.code || "", bank: account.bank || "BBVA", currency: account.currency || "PEN", accountNumber: account.accountNumber || "", cci: account.cci || "", ledgerAccount: account.ledgerAccount || "", kind: account.kind || "OPERATING", description: account.description || "", active: account.active !== false }
      : { ...emptyAccount });
  }

  const accountBody = (form) => ({ code: form.code.trim().toUpperCase(), bank: form.bank, currency: form.currency, accountNumber: form.accountNumber.trim(), cci: form.cci.replace(/[\s-]/g, ""), ledgerAccount: form.ledgerAccount.trim(), kind: form.kind, description: form.description.trim(), active: form.active });

  function submitAccount(event) {
    event.preventDefault();
    const body = accountBody(accountForm);
    const problem = accountProblem(body);
    if (problem) return setActionError(t(problem));
    run(async () => {
      if (accountForm._id) await api.put(`/treasury/accounts/${accountForm._id}`, body);
      else await api.post("/treasury/accounts", body);
      notify(accountForm._id ? "Bank account updated." : "Bank account added.");
    }, () => { setAccountForm(null); loadAccounts(); });
  }

  function confirmToggleAccount() {
    const account = toggleAccount;
    run(async () => {
      await api.put(`/treasury/accounts/${account._id}`, accountBody({ ...emptyAccount, ...account, cci: account.cci || "", description: account.description || "", active: account.active === false }));
      notify(account.active === false ? "Bank account activated." : "Bank account deactivated.");
    }, () => { setToggleAccount(null); loadAccounts(); });
  }

  // The approver's own step opens the one-page decision (the backend still checks who decides).
  const decidesStep = (row) => !readOnly && row.pendingApproval && TIER_ROLES[row.pendingApproval] === user.role && idOf(row.requester) !== idOf(user._id);

  const stageTabs = [...transferStages, "all"].map((id) => ({ id, label: transferStageLabels[id], count: id === "all" ? undefined : Number(summary[id] || 0) }));

  return (
    <section>
      <PageHeader
        title="Transfers"
        description="Transfers between UMA's own bank accounts in the same currency: registered by Treasury, approved by the Head of Treasury and the GAF, executed at the bank and reconciled."
        actions={<>
          <button type="button" className="secondary-button" onClick={reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>
          {canManage && <button type="button" className="primary-button" onClick={() => { setActionError(""); setTransferForm(emptyTransfer); setCreating(true); }} disabled={activeAccounts.length < 2}><Plus size={16} /><span>{t("New transfer")}</span></button>}
        </>}
      />
      <Message type="error">{error}</Message>
      {canManage && !accountsLoading && activeAccounts.length < 2 && <Message type="info">Register at least two active UMA bank accounts below to make a transfer.</Message>}
      {deepLink.active && <DeepLinkNotice title="Showing the transfer linked from your notification" missing={!loading && !rows.length} missingDescription="This transfer is no longer available." clearLabel="Show all transfers" onClear={() => { deepLink.clear(); setStage(canManage ? "toExecute" : "pending"); }} />}

      <div className="workspace-panel">
        {!deepLink.active && <Tabs idPrefix="transfers" label="Transfer stages" value={stage} onChange={setStage} tabs={stageTabs} />}
        <DataTable
          rows={rows}
          loading={loading}
          searchPlaceholder="Search transfer, account or requester..."
          emptyTitle="No transfers here"
          emptyDescription="Transfers between UMA's accounts appear here once Treasury registers them."
          onRowClick={(row) => navigate(`/requests/${row._id}`)}
          rowActions={(row) => {
            const status = canonicalRequestStatus(row.status);
            return [
              { label: "Execute", icon: CircleCheckBig, primary: true, hidden: !(canManage && status === "APROBADO"), onClick: () => openExecute(row) },
              { label: "Reconcile", icon: Scale, primary: true, hidden: !(canManage && status === "PAGADO"), onClick: () => openReconcile(row) },
              { label: "Correct and resend", icon: Send, primary: true, hidden: !canResubmit(row), onClick: () => openResubmit(row) },
              { label: "Open decision page", icon: PanelTop, hidden: !decidesStep(row), onClick: () => navigate(`/approvals/${row._id}`) },
              { label: "Open request", icon: ExternalLink, onClick: () => navigate(`/requests/${row._id}`) }
            ];
          }}
          columns={[
            { key: "requestNumber", type: "name", primary: true, label: "Transfer", render: (row) => <div className="primary-cell"><Link to={`/requests/${row._id}`} onClick={(event) => event.stopPropagation()}>{row.requestNumber}</Link><span>{row.title || row.description || ""}</span></div> },
            { key: "createdAt", type: "date", label: "Date", render: (row) => formatDate(row.createdAt, language) },
            { key: "route", label: "From → to", sortable: false, getValue: (row) => transferRoute(row), render: (row) => <div className="primary-cell"><strong>{transferRoute(row)}</strong><span>{t(transferPurposeLabels[row.treasuryTransfer?.purpose] || row.treasuryTransfer?.purpose || "")}</span></div> },
            { key: "totalAmount", type: "money", label: "Amount", render: (row) => <strong>{money(row.totalAmount, row.currency)}</strong> },
            { key: "priority", label: "Priority", render: (row) => <PriorityBadge priority={row.priority} /> },
            { key: "status", type: "status", label: "Status", render: (row) => <div className="primary-cell"><StatusBadge status={canonicalRequestStatus(row.status)} />{row.pendingApproval && <small>{t("Pending with")}: {t(row.pendingApproval)}</small>}</div> },
            { key: "operation", label: "Operation", sortable: false, getValue: (row) => row.treasuryTransfer?.operationNumber || "", render: (row) => row.treasuryTransfer?.operationNumber ? <div className="primary-cell"><span>{row.treasuryTransfer.operationNumber}</span><small>{formatDate(row.treasuryTransfer.executedAt, language)}</small></div> : "-" },
            { key: "requester", type: "name", label: "Registered by", sortable: false, getValue: (row) => row.requester?.name || row.solicitor?.name || "", render: (row) => row.requester?.name || row.solicitor?.name || "-" }
          ]}
        />
      </div>

      <div className="workspace-panel section-spacer">
        <div className="section-heading">
          <div><h3>{t("UMA bank accounts")}</h3><p>{t("The accounts transfers move money between, each with the class 10 ledger account its movements post to.")}</p></div>
          {canManage && <button type="button" className="secondary-button" onClick={() => openAccount(null)}><Plus size={16} /><span>{t("Add account")}</span></button>}
        </div>
        <Message type="error">{accountsError}</Message>
        <DataTable
          rows={accounts}
          loading={accountsLoading}
          searchPlaceholder="Search code, bank or account..."
          emptyTitle="No UMA bank accounts yet"
          emptyDescription={canManage ? "Add the accounts UMA moves money between." : "Treasury registers UMA's bank accounts."}
          rowActions={canManage ? (row) => [
            { label: "Edit", icon: Pencil, onClick: () => openAccount(row) },
            { label: row.active === false ? "Activate" : "Deactivate", icon: Power, onClick: () => { setActionError(""); setToggleAccount(row); } }
          ] : undefined}
          columns={[
            { key: "code", type: "code", label: "Code", render: (row) => <div className="primary-cell"><strong>{row.code}</strong>{row.description && <span>{row.description}</span>}</div> },
            { key: "bank", label: "Bank", getValue: (row) => bankDisplayName(row.bank), render: (row) => <span className="primary-cell"><Landmark size={14} aria-hidden="true" /> {bankDisplayName(row.bank)}</span> },
            { key: "currency", type: "code", label: "Currency" },
            { key: "accountNumber", label: "Account number", render: (row) => <div className="primary-cell"><span>{row.accountNumber}</span>{row.cci && <small>CCI {row.cci}</small>}</div> },
            { key: "ledgerAccount", type: "code", label: "Ledger account" },
            { key: "kind", label: "Kind", getValue: (row) => t(treasuryAccountKindLabels[row.kind] || row.kind), render: (row) => t(treasuryAccountKindLabels[row.kind] || row.kind) },
            { key: "active", type: "status", label: "Status", getValue: (row) => (row.active === false ? "INACTIVE" : "ACTIVE"), render: (row) => <StatusBadge status={row.active === false ? "INACTIVE" : "ACTIVE"} /> }
          ]}
        />
      </div>

      <Drawer
        open={creating}
        error={actionError}
        title="New transfer"
        description="It goes to the Head of Treasury (another Treasury user) and then the GAF for approval."
        onClose={() => !processing && setCreating(false)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setCreating(false)}>{t("Cancel")}</button><button type="submit" form="treasury-transfer-form" className="primary-button" disabled={processing}><ArrowRightLeft size={16} />{t(processing ? "Processing..." : "Register and send for approval")}</button></>}
      >
        <form id="treasury-transfer-form" className="form-grid" onSubmit={submitTransfer}>
          <label className="field"><span>{t("From account")} *</span><select required value={transferForm.sourceAccount} onChange={(event) => changeSource(event.target.value)}><option value="">{t("Select")}</option>{activeAccounts.map((account) => <option key={account._id} value={account._id}>{accountLabel(account)}</option>)}</select></label>
          <label className="field"><span>{t("To account")} *</span><select required value={transferForm.destinationAccount} disabled={!source} onChange={(event) => setTransferForm({ ...transferForm, destinationAccount: event.target.value })}><option value="">{t(source ? "Select" : "Choose the source account first")}</option>{destinations.map((account) => <option key={account._id} value={account._id}>{accountLabel(account)}</option>)}</select>{source && !destinations.length && <small className="field-hint">{t("No other active account in this currency.")}</small>}</label>
          <label className="field"><span>{t("Amount")}{source ? ` (${source.currency})` : ""} *</span><input required type="number" min="0.01" step="0.01" value={transferForm.amount} onChange={(event) => setTransferForm({ ...transferForm, amount: event.target.value })} /><small className="field-hint">{t("Both accounts are in the same currency: a transfer never converts currency.")}</small></label>
          <label className="field"><span>{t("Purpose")} *</span><select required value={transferForm.purpose} onChange={(event) => setTransferForm({ ...transferForm, purpose: event.target.value })}>{Object.entries(transferPurposeLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label className="field"><span>{t("Priority")} *</span><select required value={transferForm.priority} onChange={(event) => setTransferForm({ ...transferForm, priority: event.target.value })}>{[...requestPriorities].reverse().map((value) => <option key={value} value={value}>{t(requestPriorityLabels[value])}</option>)}</select></label>
          {transferForm.purpose === "INVESTMENT" && <>
            <label className="field"><span>{t("Instrument")}</span><input value={transferForm.instrument} placeholder={t("e.g. 60-day fixed-term deposit")} onChange={(event) => setTransferForm({ ...transferForm, instrument: event.target.value })} /></label>
            <label className="field"><span>{t("Reference")}</span><input value={transferForm.reference} placeholder={t("Certificate or contract number")} onChange={(event) => setTransferForm({ ...transferForm, reference: event.target.value })} /></label>
          </>}
          <label className="field wide"><span>{t("Description")} *</span><textarea required rows="3" value={transferForm.description} placeholder={t("What it funds, or which placement")} onChange={(event) => setTransferForm({ ...transferForm, description: event.target.value })} /></label>
          <label className="field wide"><span>{t("Justification")}</span><textarea rows="2" value={transferForm.justification} onChange={(event) => setTransferForm({ ...transferForm, justification: event.target.value })} /></label>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(executeRow)}
        error={actionError}
        title="Execute transfer"
        description={executeRow ? `${executeRow.requestNumber} · ${transferRoute(executeRow)} · ${money(executeRow.totalAmount, executeRow.currency)}` : ""}
        onClose={() => !processing && setExecuteRow(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setExecuteRow(null)}>{t("Cancel")}</button><button type="submit" form="transfer-execute-form" className="primary-button" disabled={processing}><CircleCheckBig size={16} />{t(processing ? "Processing..." : "Record execution")}</button></>}
      >
        <p className="muted-text">{t("Make the transfer at the bank first, then record its operation number. This posts the journal entry and marks the transfer as paid.")}</p>
        <form id="transfer-execute-form" className="form-grid" onSubmit={submitExecute}>
          <label className="field"><span>{t("Operation number")} *</span><input required value={executeForm.operationNumber} onChange={(event) => setExecuteForm({ ...executeForm, operationNumber: event.target.value })} /></label>
          <label className="field"><span>{t("Execution date")} *</span><DateInput required max={limaDateKey(new Date())} value={executeForm.executedAt} onChange={(event) => setExecuteForm({ ...executeForm, executedAt: event.target.value })} /></label>
          <label className="field wide"><span>{t("Comments")}</span><textarea rows="3" value={executeForm.comments} onChange={(event) => setExecuteForm({ ...executeForm, comments: event.target.value })} /></label>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(reconcileRow)}
        error={actionError}
        title="Reconcile transfer"
        description={reconcileRow ? `${reconcileRow.requestNumber} · ${transferRoute(reconcileRow)} · ${money(reconcileRow.totalAmount, reconcileRow.currency)}` : ""}
        onClose={() => !processing && setReconcileRow(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setReconcileRow(null)}>{t("Cancel")}</button><button type="submit" form="transfer-reconcile-form" className="primary-button" disabled={processing}><Scale size={16} />{t(processing ? "Processing..." : "Reconcile and close")}</button></>}
      >
        <p className="muted-text">{t("Match the transfer with the bank statement. Reconciling closes the request.")}</p>
        <form id="transfer-reconcile-form" className="form-grid" onSubmit={submitReconcile}>
          <label className="field"><span>{t("Statement reference")}</span><input value={reconcileForm.bankReference} onChange={(event) => setReconcileForm({ ...reconcileForm, bankReference: event.target.value })} /></label>
          <label className="field"><span>{t("Amount on the statement")}{reconcileRow ? ` (${reconcileRow.currency})` : ""}</span><input type="number" min="0" step="0.01" value={reconcileForm.statementAmount} onChange={(event) => setReconcileForm({ ...reconcileForm, statementAmount: event.target.value })} /></label>
          <label className="field wide"><span>{t("Comments")}{statementDiffers ? " *" : ""}</span><textarea rows="3" required={Boolean(statementDiffers)} value={reconcileForm.comments} onChange={(event) => setReconcileForm({ ...reconcileForm, comments: event.target.value })} />{statementDiffers && <small className="field-hint">{t("The statement amount differs from the transfer: explain the difference.")}</small>}</label>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(resubmitRow)}
        error={actionError}
        title="Correct and resend"
        description={resubmitRow ? `${resubmitRow.requestNumber} · ${transferRoute(resubmitRow)}` : ""}
        onClose={() => !processing && setResubmitRow(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setResubmitRow(null)}>{t("Cancel")}</button><button type="submit" form="transfer-resubmit-form" className="primary-button" disabled={processing}><Send size={16} />{t(processing ? "Processing..." : "Send for approval again")}</button></>}
      >
        {resubmitRow && sentBackComment(resubmitRow) && <div className="inline-alert alert-warning"><div><strong>{t("The approver's comment")}</strong><span>{sentBackComment(resubmitRow)}</span></div></div>}
        <p className="muted-text">{t("The accounts stay the same. Correct the amount or the description; the approval starts again from the Head of Treasury.")}</p>
        <form id="transfer-resubmit-form" className="form-grid" onSubmit={submitResubmit}>
          <label className="field"><span>{t("Amount")}{resubmitRow ? ` (${resubmitRow.currency})` : ""} *</span><input required type="number" min="0.01" step="0.01" value={resubmitForm.amount} onChange={(event) => setResubmitForm({ ...resubmitForm, amount: event.target.value })} /></label>
          <label className="field wide"><span>{t("Description")} *</span><textarea required rows="3" value={resubmitForm.description} onChange={(event) => setResubmitForm({ ...resubmitForm, description: event.target.value })} /></label>
          <label className="field wide"><span>{t("Comments")}</span><textarea rows="2" value={resubmitForm.comments} onChange={(event) => setResubmitForm({ ...resubmitForm, comments: event.target.value })} /></label>
        </form>
      </Drawer>

      <Drawer
        open={Boolean(accountForm)}
        error={actionError}
        title={accountForm?._id ? "Edit UMA bank account" : "Add UMA bank account"}
        onClose={() => !processing && setAccountForm(null)}
        footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setAccountForm(null)}>{t("Cancel")}</button><button type="submit" form="treasury-account-form" className="primary-button" disabled={processing}>{t(processing ? "Saving..." : "Save")}</button></>}
      >
        {accountForm && <form id="treasury-account-form" className="form-grid" onSubmit={submitAccount}>
          <label className="field"><span>{t("Code")} *</span><input required value={accountForm.code} placeholder={"BBVA-PEN"} onChange={(event) => setAccountForm({ ...accountForm, code: event.target.value.toUpperCase() })} /></label>
          <label className="field"><span>{t("Bank")} *</span><select required value={accountForm.bank} onChange={(event) => setAccountForm({ ...accountForm, bank: event.target.value })}>{accountBanks.map((bank) => <option key={bank.code} value={bank.code}>{bank.name}</option>)}</select></label>
          <label className="field"><span>{t("Currency")} *</span><select required value={accountForm.currency} onChange={(event) => setAccountForm({ ...accountForm, currency: event.target.value })}>{currencies.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <label className="field"><span>{t("Account number")} *</span><input required value={accountForm.accountNumber} onChange={(event) => setAccountForm({ ...accountForm, accountNumber: event.target.value })} /></label>
          <label className="field"><span>CCI</span><input inputMode="numeric" maxLength={24} value={accountForm.cci} onChange={(event) => setAccountForm({ ...accountForm, cci: event.target.value })} /><small className="field-hint">{t("Optional: 20 digits.")}</small></label>
          <label className="field"><span>{t("Ledger account")} *</span><input required inputMode="numeric" value={accountForm.ledgerAccount} placeholder={"104101"} onChange={(event) => setAccountForm({ ...accountForm, ledgerAccount: event.target.value })} /><small className="field-hint">{t("The class 10 account its movements post to, e.g. 104101.")}</small></label>
          <label className="field"><span>{t("Kind")} *</span><select required value={accountForm.kind} onChange={(event) => setAccountForm({ ...accountForm, kind: event.target.value })}>{Object.entries(treasuryAccountKindLabels).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          <label className="field wide"><span>{t("Description")}</span><input value={accountForm.description} onChange={(event) => setAccountForm({ ...accountForm, description: event.target.value })} /></label>
          <label className="quick-check"><input type="checkbox" checked={accountForm.active} onChange={(event) => setAccountForm({ ...accountForm, active: event.target.checked })} /><span>{t("Active")}</span></label>
        </form>}
      </Drawer>

      <ConfirmDialog
        open={Boolean(toggleAccount)}
        tone={toggleAccount?.active === false ? "primary" : "danger"}
        title={toggleAccount?.active === false ? "Activate this bank account?" : "Deactivate this bank account?"}
        description={toggleAccount?.active === false ? "It can be chosen again for new transfers." : "It can no longer be chosen for new transfers. Transfers already registered keep it."}
        details={toggleAccount ? [{ label: "Account", value: accountLabel(toggleAccount) }] : []}
        confirmLabel={toggleAccount?.active === false ? "Activate" : "Deactivate"}
        error={actionError}
        loading={processing}
        onClose={() => !processing && setToggleAccount(null)}
        onConfirm={confirmToggleAccount}
      />
    </section>
  );
}
