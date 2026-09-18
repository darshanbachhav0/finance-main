import useWorkDraft, { useDraftResume, resumeDraftRecord } from "../../hooks/useWorkDraft.js";
import DraftPanel from "../../components/DraftPanel.jsx";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  CheckCircle2,
  FileSignature,
  Landmark,
  MapPin,
  MessageSquareWarning,
  Plus,
  ReceiptText,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import api from "../../api/client.js";
import ConfirmDialog from "../ConfirmDialog.jsx";
import Message from "../Message.jsx";
import StatusBadge from "../StatusBadge.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { useToast } from "../../context/ToastContext.jsx";
import { canonicalRequestStatus } from "../../../../shared/workflowStatus.mjs";

const today = () => new Date().toISOString().slice(0, 10);
const key = () => `${Date.now()}-${Math.random()}`;
const emptyMobility = () => ({ clientId: key(), date: today(), origin: "", destination: "", servicePurpose: "", amount: "" });
const emptyUnsupported = () => ({ clientId: key(), date: today(), description: "", goodsServiceType: "SERVICES", grossAmount: "" });

function asAccountingLine(line) {
  return {
    clientId: line._id || key(),
    costCenter: line.costCenter?._id || line.costCenter || "",
    expenseType: line.expenseType?._id || line.expenseType || "",
    netAmount: line.netAmount ?? "",
    igvAmount: line.igvAmount ?? "",
    totalAmount: line.totalAmount ?? ""
  };
}

function asMobility(line) {
  return { clientId: line._id || key(), date: line.date?.slice?.(0, 10) || today(), origin: line.origin || "", destination: line.destination || "", servicePurpose: line.servicePurpose || "", amount: line.amount ?? "", limitExceeded: line.limitExceeded };
}

function asUnsupported(line) {
  return { clientId: line._id || key(), date: line.date?.slice?.(0, 10) || today(), description: line.description || "", goodsServiceType: line.goodsServiceType || "SERVICES", grossAmount: line.grossAmount ?? "" };
}

function sum(rows, field) {
  return Math.round(rows.reduce((total, row) => total + Number(row[field] || 0), 0) * 100) / 100;
}

function Section({ icon: Icon, title, description, action, children }) {
  const { t } = useLanguage();
  return <section className="rendition-section"><header><span className="section-icon"><Icon size={17} /></span><div><h4>{t(title)}</h4><p>{t(description)}</p></div>{action}</header>{children}</section>;
}

function ReadOnlyRows({ rows, type }) {
  const { t } = useLanguage();
  if (!rows.length) return <p className="empty-inline">{t("No details recorded.")}</p>;
  return <div className="rendition-record-list">{rows.map((row, index) => <div key={row._id || index} className={row.limitExceeded ? "has-warning" : ""}>
    <span>{row.date ? new Date(row.date).toLocaleDateString() : "-"}</span>
    <strong>{type === "mobility" ? `${row.origin} - ${row.destination}` : row.description}</strong>
    <small>{type === "mobility" ? row.servicePurpose : t(row.goodsServiceType)}</small>
    <b>PEN {Number(type === "mobility" ? row.amount : row.grossAmount).toFixed(2)}</b>
  </div>)}</div>;
}

export default function OfficialRenditionWorkspace({ request, masters, user, onReload }) {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [policy, setPolicy] = useState({ mobility: null, unsupportedExpense: null });
  const [bankAccounts, setBankAccounts] = useState([]);
  const [bankDestination, setBankDestination] = useState(null);
  const [accountingLines, setAccountingLines] = useState([]);
  const [mobilityLines, setMobilityLines] = useState([]);
  const [unsupportedLines, setUnsupportedLines] = useState([]);
  const [amountReturned, setAmountReturned] = useState("0");
  const [selectedBank, setSelectedBank] = useState("");
  const [exceptionalUse, setExceptionalUse] = useState(false);
  const [exceptionalComments, setExceptionalComments] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [comments, setComments] = useState("");
  const [files, setFiles] = useState([]);
  const [error, setError] = useState("");
  const [processing, setProcessing] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [settlement, setSettlement] = useState({ amount: "", method: "REIMBURSEMENT", reference: "" });

  const ownerId = request.requester?._id || request.solicitor?._id || request.requester || request.solicitor;
  const owner = String(ownerId) === String(user._id);
  const isAdvance = request.requestType === "ENTREGA_RENDIR";
  const isReimbursement = request.requestType === "REEMBOLSO_SIN_SUSTENTO";
  const canSubmit = (user.role === "Admin" || owner)
    && ["PENDING", "OBSERVED", "NOT_REQUIRED"].includes(request.rendition?.status || "NOT_REQUIRED")
    && (isAdvance ? ["PAGADO", "CONCILIADO"].includes(canonicalRequestStatus(request.status)) : canonicalRequestStatus(request.status) === "COMPROMISO_PRESUPUESTAL")
    && request.rendition?.financeReview?.result !== "REJECTED";
  const canReview = ["Admin", "Accounting"].includes(user.role)
    && request.rendition?.status === "SUBMITTED"
    && request.rendition?.financeReview?.result === "PENDING";
  const canSettle = ["Admin", "Accounting", "Treasury"].includes(user.role)
    && isAdvance
    && request.rendition?.status === "VALIDATED"
    && Number(request.rendition?.nonDeductibleOutstanding || 0) > 0;

  useEffect(() => {
    setAccountingLines((request.rendition?.lines?.length ? request.rendition.lines : request.lines || []).map(asAccountingLine));
    setMobilityLines((request.rendition?.mobilityLines || []).map(asMobility));
    setUnsupportedLines((request.rendition?.unsupportedExpenseLines || []).map(asUnsupported));
    setAmountReturned(String(request.rendition?.amountReturned || 0));
    setExceptionalUse(Boolean(request.rendition?.unsupportedExpenseDeclaration?.confirmedExceptionalUse));
    setExceptionalComments(request.rendition?.unsupportedExpenseDeclaration?.comments || "");
  }, [request._id, request.updatedAt]);

  useEffect(() => {
    Promise.all([
      api.get(`/requests/${request._id}/rendition/policy`),
      api.get("/employee-bank-accounts", { params: { user: ownerId, active: true } }).catch(() => ({ data: { data: [] } })),
      api.get(`/requests/${request._id}/rendition/bank-destination`).catch(() => ({ data: { data: null } }))
    ]).then(([policyResponse, bankResponse, destinationResponse]) => {
      setPolicy(policyResponse.data.data || {});
      const accounts = bankResponse.data.data || [];
      setBankAccounts(accounts);
      setSelectedBank(current => current || accounts.find((item) => item.preferred && item.verificationStatus === "VERIFIED")?._id || "");
      setBankDestination(destinationResponse.data.data || null);
    }).catch((err) => setError(err.message));
  }, [request._id, ownerId]);

  const draft = useWorkDraft({ scope: "rendition", recordId: request._id, title: "Expense rendition", enabled: canSubmit, sourceVersion: request.updatedAt,
    value: { accountingLines, mobilityLines, unsupportedLines, amountReturned, selectedBank, exceptionalUse, exceptionalComments, comments, files },
    restore: data => { setAccountingLines(data.accountingLines); setMobilityLines(data.mobilityLines); setUnsupportedLines(data.unsupportedLines); setAmountReturned(data.amountReturned); setSelectedBank(data.selectedBank); setExceptionalUse(data.exceptionalUse); setExceptionalComments(data.exceptionalComments); setComments(data.comments); setFiles(data.files || []); setAcknowledged(false); }
  });
  const settlementDraft = useWorkDraft({ scope: "rendition-settlement", recordId: request._id, title: "Rendition settlement", enabled: canSettle, value: settlement, restore: setSettlement });

  const mobilitySubtotal = useMemo(() => sum(mobilityLines, "amount"), [mobilityLines]);
  const unsupportedSubtotal = useMemo(() => sum(unsupportedLines, "grossAmount"), [unsupportedLines]);
  const officialTotal = Math.round((mobilitySubtotal + unsupportedSubtotal) * 100) / 100;
  const accountingAmount = isAdvance ? sum(accountingLines, "totalAmount") : Number(request.totalAmount || 0);
  const difference = Math.round((officialTotal - accountingAmount) * 100) / 100;
  const advancedAmount = Number(request.rendition?.amountAdvanced || request.payment?.confirmedAmount || request.totalAmount || 0);
  const balance = isAdvance ? Math.round((advancedAmount - accountingAmount - Number(amountReturned || 0)) * 100) / 100 : 0;
  const dailyMobility = useMemo(() => mobilityLines.reduce((map, line) => ({ ...map, [line.date]: Math.round(((map[line.date] || 0) + Number(line.amount || 0)) * 100) / 100 }), {}), [mobilityLines]);
  const warningDates = policy.mobility ? Object.entries(dailyMobility).filter(([, amount]) => amount > Number(policy.mobility.numericValue || 0)).map(([date]) => date) : [];
  const dueAt = request.rendition?.dueAt ? new Date(request.rendition.dueAt) : null;
  const renditionOverdue = Boolean(dueAt && !Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now() && !["VALIDATED", "REJECTED"].includes(request.rendition?.status));
  const nonDeductibleOutstanding = Number(request.rendition?.nonDeductibleOutstanding || 0);

  function updateRows(setter, index, field, value) {
    setter((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row));
  }

  async function submit(event) {
    event.preventDefault(); if (!draft.ready || draft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    setError("");
    const data = new FormData();
    files.forEach((file) => data.append("rendition", file));
    data.append("lines", JSON.stringify(accountingLines.map(({ clientId, ...line }) => line)));
    data.append("mobilityLines", JSON.stringify(mobilityLines.map(({ clientId, limitExceeded, ...line }) => line)));
    data.append("unsupportedExpenseLines", JSON.stringify(unsupportedLines.map(({ clientId, ...line }) => line)));
    data.append("amountReturned", amountReturned || "0");
    data.append("confirmedExceptionalUse", String(exceptionalUse));
    data.append("exceptionalUseComments", exceptionalComments);
    data.append("beneficiaryAcknowledged", String(acknowledged));
    data.append("reimbursementBankProfile", selectedBank);
    data.append("comments", comments);
    try {
      await api.post(`/requests/${request._id}/rendition`, data, { headers: { "Content-Type": "multipart/form-data" } });
      await draft.complete();
      notify("Official rendition submitted for Finance review.");
      setFiles([]);
      setAcknowledged(false);
      await onReload();
    } catch (err) {
      setError(`${err.message}${err.code ? ` (${err.code})` : ""}`);
      notify(err.message, "error");
    } finally { setProcessing(false); }
  }

  async function review(action, reviewComments) {
    setProcessing(true);
    try {
      await api.post(`/requests/${request._id}/rendition/${action}`, { comments: reviewComments });
      notify(action === "approve" ? "Finance approved the rendition." : action === "observe" ? "Rendition observed and returned for correction." : "Finance rejected the rendition.");
      setConfirm(null);
      await onReload();
    } catch (err) { setError(err.message); notify(err.message, "error"); setConfirm(null); }
    finally { setProcessing(false); }
  }

  async function settleNonDeductible(event) {
    event.preventDefault(); if (!settlementDraft.ready || settlementDraft.status === "conflict") return;
    event.preventDefault();
    setProcessing(true);
    setError("");
    try {
      await api.post(`/requests/${request._id}/rendition/settle-non-deductible`, settlement);
      await settlementDraft.complete();
      notify("Account 14 balance regularized and audit entry created.");
      setSettlement({ amount: "", method: "REIMBURSEMENT", reference: "" });
      await onReload();
    } catch (err) {
      setError(err.message);
      notify(err.message, "error");
    } finally {
      setProcessing(false);
    }
  }

  const editable = canSubmit && draft.ready && draft.status !== "conflict";
  return <div className="workspace-panel detail-section official-rendition-workspace">
    <div className="section-heading"><div><h3>{t("Expense Rendition")}</h3><p>{t(isAdvance ? "Settle the paid advance with official detail while existing Accounting lines remain authoritative." : "Document the exceptional unsupported reimbursement before existing Accounting processing.")}</p></div><div className="rendition-heading-status"><strong>{request.rendition?.number || t("Assigned on submission")}</strong><StatusBadge status={request.rendition?.financeReview?.result || request.rendition?.status || "PENDING"} /></div></div>
    <Message type="error">{error}</Message>
    {canSubmit && <DraftPanel busy={processing} draft={draft} onDiscard={() => { draft.separateCopy(); window.location.reload(); }} />}
    {isAdvance && dueAt && <div className={`rendition-deadline-card${renditionOverdue ? " overdue" : ""}`}><AlertTriangle size={18} /><div><strong>{t(renditionOverdue ? "Rendition overdue" : "Rendition deadline")}</strong><p>{t("Supporting documents must be submitted within 10 days after the advance payment.")} {t("Due")}: {dueAt.toLocaleDateString()}</p></div><StatusBadge status={renditionOverdue ? "OVERDUE" : request.rendition?.status || "PENDING"} /></div>}

    <fieldset className="work-draft-fields" disabled={processing}>
    <Section icon={BadgeCheck} title="Employee Information" description="Identity and CECO come from the authenticated employee and parent request.">
      <dl className="detail-grid rendition-identity"><div><dt>{t("Beneficiary")}</dt><dd>{request.rendition?.beneficiarySnapshot?.name || request.requester?.name || request.solicitor?.name}</dd></div><div><dt>{t("Employee Code")}</dt><dd>{request.rendition?.beneficiarySnapshot?.employeeCode || request.requester?.employeeCode || request.solicitor?.employeeCode || "-"}</dd></div><div><dt>{t("Institutional email")}</dt><dd>{request.rendition?.beneficiarySnapshot?.email || request.requester?.email || request.solicitor?.email || "-"}</dd></div><div><dt>{t("Area")}</dt><dd>{request.rendition?.beneficiarySnapshot?.area || request.requesterArea}</dd></div><div><dt>{t("Cost Center / CECO")}</dt><dd>{request.rendition?.beneficiarySnapshot?.costCenterCode || request.requesterCostCenter?.code} - {request.rendition?.beneficiarySnapshot?.costCenterName || request.requesterCostCenter?.name}</dd></div></dl>
    </Section>

    <Section icon={MapPin} title="Local Transportation" description="Repeatable PEN mobility details; the daily configuration is a warning unless Finance configures blocking behavior." action={editable && <button type="button" className="secondary-button compact-button" onClick={() => setMobilityLines((rows) => [...rows, emptyMobility()])}><Plus size={15} />{t("Add row")}</button>}>
      {editable ? <div className="repeatable-lines">{mobilityLines.map((line, index) => <div className={`repeatable-line mobility-line${warningDates.includes(line.date) ? " has-warning" : ""}`} key={line.clientId}><span className="line-number">{index + 1}</span><label className="field"><span>{t("Date")} *</span><input type="date" required value={line.date} onChange={(event) => updateRows(setMobilityLines, index, "date", event.target.value)} /></label><label className="field"><span>{t("Origin")} *</span><input required value={line.origin} onChange={(event) => updateRows(setMobilityLines, index, "origin", event.target.value)} /></label><label className="field"><span>{t("Destination")} *</span><input required value={line.destination} onChange={(event) => updateRows(setMobilityLines, index, "destination", event.target.value)} /></label><label className="field line-purpose"><span>{t("Service Purpose")} *</span><input required value={line.servicePurpose} onChange={(event) => updateRows(setMobilityLines, index, "servicePurpose", event.target.value)} /></label><label className="field"><span>{t("Amount")} (PEN) *</span><input type="number" min="0.01" step="0.01" required value={line.amount} onChange={(event) => updateRows(setMobilityLines, index, "amount", event.target.value)} /></label><button type="button" className="icon-button danger-icon" onClick={() => setMobilityLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={t("Remove row")}><Trash2 size={16} /></button></div>)}{!mobilityLines.length && <p className="empty-inline">{t("No mobility rows added.")}</p>}</div> : <ReadOnlyRows rows={request.rendition?.mobilityLines || []} type="mobility" />}
      <div className="rendition-section-footer"><span>{t("Mobility Subtotal")}</span><strong>PEN {Number(editable ? mobilitySubtotal : request.rendition?.mobilitySubtotal || 0).toFixed(2)}</strong></div>
      {policy.mobility && <div className={`inline-alert ${warningDates.length || request.rendition?.limitEvaluation?.exceededLineCount ? "alert-warning" : "alert-info"}`}><AlertTriangle size={17} /><div><strong>{t("Daily Mobility Limit")}: PEN {Number(policy.mobility.numericValue).toFixed(2)}</strong><span>{t(warningDates.length || request.rendition?.limitEvaluation?.exceededLineCount ? "One or more days exceed the configured warning value. Submission is not automatically rejected." : "Current entries are within the effective configured value.")}</span></div></div>}
    </Section>

    <Section icon={ReceiptText} title="Expenses Without Supporting Documents" description="Exceptional lines require a detailed description and do not fabricate fiscal evidence." action={editable && <button type="button" className="secondary-button compact-button" onClick={() => setUnsupportedLines((rows) => [...rows, emptyUnsupported()])}><Plus size={15} />{t("Add row")}</button>}>
      {editable ? <div className="repeatable-lines">{unsupportedLines.map((line, index) => <div className="repeatable-line unsupported-line" key={line.clientId}><span className="line-number">{index + 1}</span><label className="field"><span>{t("Date")} *</span><input type="date" required value={line.date} onChange={(event) => updateRows(setUnsupportedLines, index, "date", event.target.value)} /></label><label className="field line-description"><span>{t("Detailed Expense Description")} *</span><input required value={line.description} onChange={(event) => updateRows(setUnsupportedLines, index, "description", event.target.value)} /></label><label className="field"><span>{t("Goods / Services")} *</span><select value={line.goodsServiceType} onChange={(event) => updateRows(setUnsupportedLines, index, "goodsServiceType", event.target.value)}><option value="GOODS">{t("Goods")}</option><option value="SERVICES">{t("Services")}</option></select></label><label className="field"><span>{t("Gross Amount")} (PEN) *</span><input type="number" min="0.01" step="0.01" required value={line.grossAmount} onChange={(event) => updateRows(setUnsupportedLines, index, "grossAmount", event.target.value)} /></label><button type="button" className="icon-button danger-icon" onClick={() => setUnsupportedLines((rows) => rows.filter((_, rowIndex) => rowIndex !== index))} aria-label={t("Remove row")}><Trash2 size={16} /></button></div>)}{!unsupportedLines.length && <p className="empty-inline">{t("No unsupported-expense rows added.")}</p>}</div> : <ReadOnlyRows rows={request.rendition?.unsupportedExpenseLines || []} type="unsupported" />}
      <div className="rendition-section-footer"><span>{t("Unsupported Expense Subtotal")}</span><strong>PEN {Number(editable ? unsupportedSubtotal : request.rendition?.unsupportedExpenseSubtotal || 0).toFixed(2)}</strong></div>
      {!policy.unsupportedExpense && ["Admin", "Accounting"].includes(user.role) && <p className="section-note warning-note">{t("No system-configured unsupported-expense management limit exists. No numeric threshold has been invented.")}</p>}
    </Section>

    {isReimbursement && <Section icon={Landmark} title="Reimbursement Banking" description="A verified employee account is required only because this workflow expects reimbursement to the employee.">
      {editable ? <div className="bank-selector-row"><label className="field"><span>{t("Reimbursement Bank")} *</span><select required value={selectedBank} onChange={(event) => setSelectedBank(event.target.value)}><option value="">{t("Select a verified account")}</option>{bankAccounts.filter((item) => item.active).map((item) => <option key={item._id} value={item._id} disabled={item.verificationStatus !== "VERIFIED"}>{item.bank} · {item.accountNumberMasked} · {t(item.verificationStatus)}</option>)}</select></label><Link className="secondary-button" to="/reimbursement-bank"><Banknote size={16} />{t("Manage bank profiles")}</Link></div> : bankDestination ? <dl className="detail-grid"><div><dt>{t("Reimbursement Bank")}</dt><dd>{bankDestination.bank} / {bankDestination.currency}</dd></div><div><dt>{t("Account Number")}</dt><dd>{bankDestination.accountNumberMasked || bankDestination.accountNumber}</dd></div><div><dt>{t("CCI")}</dt><dd>{bankDestination.cciMasked || bankDestination.cci}</dd></div><div><dt>{t("Verification")}</dt><dd><StatusBadge status={bankDestination.verificationStatus} /></dd></div><div><dt>{t("Snapshot captured")}</dt><dd>{bankDestination.capturedAt ? new Date(bankDestination.capturedAt).toLocaleString() : "-"}</dd></div></dl> : <p className="empty-inline">{t("No reimbursement bank snapshot is stored.")}</p>}
    </Section>}

    {isAdvance && <Section icon={ReceiptText} title="Accounting Allocation" description="Existing Accounting dimensions remain authoritative for posting and advance clearance.">
      {editable ? <div className="repeatable-lines">{accountingLines.map((line, index) => <div className="repeatable-line accounting-rendition-line" key={line.clientId}><span className="line-number">{index + 1}</span><label className="field"><span>{t("Cost center")} *</span><select required value={line.costCenter} onChange={(event) => updateRows(setAccountingLines, index, "costCenter", event.target.value)}><option value="">{t("Select")}</option>{masters.costCenters.map((item) => <option key={item._id} value={item._id}>{item.code} - {item.name}</option>)}</select></label><label className="field"><span>{t("Expense account")} *</span><select required value={line.expenseType} onChange={(event) => updateRows(setAccountingLines, index, "expenseType", event.target.value)}><option value="">{t("Select")}</option>{masters.expenseTypes.map((item) => <option key={item._id} value={item._id}>{item.accountNumber} - {item.name}</option>)}</select></label><label className="field"><span>{t("Net")} *</span><input type="number" min="0" step="0.01" required value={line.netAmount} onChange={(event) => updateRows(setAccountingLines, index, "netAmount", event.target.value)} /></label><label className="field"><span>{t("IGV")} *</span><input type="number" min="0" step="0.01" required value={line.igvAmount} onChange={(event) => updateRows(setAccountingLines, index, "igvAmount", event.target.value)} /></label><label className="field"><span>{t("Total")} *</span><input type="number" min="0.01" step="0.01" required value={line.totalAmount} onChange={(event) => updateRows(setAccountingLines, index, "totalAmount", event.target.value)} /></label></div>)}</div> : <div className="rendition-record-list">{(request.rendition?.lines || []).map((line, index) => <div key={line._id || index}><span>{line.costCenter?.code || "CECO"}</span><strong>{line.expenseType?.accountNumber || t("Expense account")}</strong><small>{line.expenseType?.name || "-"}</small><b>{request.currency} {Number(line.totalAmount || 0).toFixed(2)}</b></div>)}</div>}
      <div className="rendition-section-footer"><span>{t("Accounting Amount")}</span><strong>{request.currency} {Number(accountingAmount).toFixed(2)}</strong></div>
    </Section>}

    <Section icon={Banknote} title="Totals / Reconciliation" description="The server recalculates all official totals and never trusts browser-submitted subtotals.">
      <div className="rendition-totals"><div><span>{t("Mobility Subtotal")}</span><strong>PEN {Number(editable ? mobilitySubtotal : request.rendition?.mobilitySubtotal || 0).toFixed(2)}</strong></div><div><span>{t("Unsupported Expense Subtotal")}</span><strong>PEN {Number(editable ? unsupportedSubtotal : request.rendition?.unsupportedExpenseSubtotal || 0).toFixed(2)}</strong></div><div><span>{t("Total to Reimburse")}</span><strong>PEN {Number(editable ? officialTotal : request.rendition?.reimbursementTotal || 0).toFixed(2)}</strong></div><div><span>{t("Accounting Amount")}</span><strong>PEN {Number(editable ? accountingAmount : request.rendition?.detailReconciliation?.accountingRenderedAmount || request.rendition?.amountRendered || 0).toFixed(2)}</strong></div><div><span>{t("Difference")}</span><strong className={Math.abs(editable ? difference : request.rendition?.detailReconciliation?.difference || 0) < 0.01 ? "text-success" : "text-warning"}>PEN {Number(editable ? difference : request.rendition?.detailReconciliation?.difference || 0).toFixed(2)}</strong></div><div><span>{t("Reconciliation")}</span><StatusBadge status={editable ? (Math.abs(difference) < 0.01 ? "MATCH" : "MISMATCH") : request.rendition?.detailReconciliation?.status} /></div></div>
      {isAdvance && <div className="advance-reconciliation"><span>{t("Amount advanced")}: PEN {advancedAmount.toFixed(2)}</span>{editable && <label className="field"><span>{t("Amount returned")}</span><input type="number" min="0" step="0.01" value={amountReturned} onChange={(event) => setAmountReturned(event.target.value)} /></label>}<span>{t("Outstanding balance")}: <strong className={Math.abs(balance) < 0.01 ? "text-success" : "text-warning"}>PEN {Number(editable ? balance : request.rendition?.balanceOutstanding || 0).toFixed(2)}</strong></span></div>}
    </Section>

    {isAdvance && request.rendition?.status === "VALIDATED" && <Section icon={Landmark} title="Account 14 Regularization" description="Non-deductible amounts remain charged to the collaborator until reimbursement or payroll deduction is recorded.">
      <div className="non-deductible-summary"><div><span>{t("Non-deductible outstanding")}</span><strong className={nonDeductibleOutstanding > 0 ? "text-warning" : "text-success"}>PEN {nonDeductibleOutstanding.toFixed(2)}</strong></div><div><span>{t("Settlement status")}</span><StatusBadge status={nonDeductibleOutstanding > 0 ? "PENDING" : "RESOLVED"} /></div></div>
      {(request.rendition?.nonDeductibleSettlements || []).length > 0 && <div className="compact-lines">{request.rendition.nonDeductibleSettlements.map((item, index) => <div key={item._id || `${item.method}-${item.settledAt}-${index}`}><span>{new Date(item.settledAt).toLocaleString()} · {t(item.method)} · {item.reference}</span><strong>PEN {Number(item.amount || 0).toFixed(2)}</strong></div>)}</div>}
      {canSettle && <DraftPanel busy={processing} draft={settlementDraft}><form className="non-deductible-settlement-form" onSubmit={settleNonDeductible}><label className="field"><span>{t("Settlement method")} *</span><select required value={settlement.method} onChange={(event) => setSettlement({ ...settlement, method: event.target.value })}><option value="REIMBURSEMENT">{t("Employee reimbursement")}</option><option value="PAYROLL_DEDUCTION">{t("Payroll deduction")}</option></select></label><label className="field"><span>{t("Amount")} *</span><input required type="number" min="0.01" max={nonDeductibleOutstanding} step="0.01" value={settlement.amount} onChange={(event) => setSettlement({ ...settlement, amount: event.target.value })} /></label><label className="field"><span>{t("Receipt / payroll reference")} *</span><input required value={settlement.reference} onChange={(event) => setSettlement({ ...settlement, reference: event.target.value })} /></label><button type="submit" className="primary-button" disabled={processing}><CheckCircle2 size={16} />{t(processing ? "Processing..." : "Regularize balance")}</button></form></DraftPanel>}
    </Section>}

    {(editable || unsupportedLines.length > 0 || request.rendition?.unsupportedExpenseLines?.length > 0) && <Section icon={FileSignature} title="Exceptional Use Declaration" description="This is the employee declaration, not Finance approval.">
      {editable ? <><label className="checkbox-row"><input type="checkbox" checked={exceptionalUse} onChange={(event) => setExceptionalUse(event.target.checked)} /><span>{t("I confirm these expenses belong to the exceptional process where valid supporting documents were unavailable.")}</span></label><label className="field"><span>{t("Declaration comments")}</span><textarea rows="2" value={exceptionalComments} onChange={(event) => setExceptionalComments(event.target.value)} /></label></> : <dl className="detail-grid"><div><dt>{t("Declaration")}</dt><dd>{request.rendition?.unsupportedExpenseDeclaration?.confirmedExceptionalUse ? t("Confirmed") : t("Not confirmed")}</dd></div><div><dt>{t("Declared")}</dt><dd>{request.rendition?.unsupportedExpenseDeclaration?.declaredAt ? new Date(request.rendition.unsupportedExpenseDeclaration.declaredAt).toLocaleString() : "-"}</dd></div><div className="wide"><dt>{t("Comments")}</dt><dd>{request.rendition?.unsupportedExpenseDeclaration?.comments || "-"}</dd></div></dl>}
    </Section>}

    <Section icon={FileSignature} title="Beneficiary Acknowledgment" description="Authenticated electronic acknowledgment; this is not described as a certified digital signature.">
      {editable ? <label className="checkbox-row acknowledgment"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /><span><strong>{t("I acknowledge the accuracy of this rendition and submit it using my authenticated account.")}</strong><small>{user.name} · {user.email}</small></span></label> : <dl className="detail-grid"><div><dt>{t("Signer")}</dt><dd>{request.rendition?.beneficiaryAcknowledgment?.signerName || "-"}</dd></div><div><dt>{t("Signed")}</dt><dd>{request.rendition?.beneficiaryAcknowledgment?.signedAt ? new Date(request.rendition.beneficiaryAcknowledgment.signedAt).toLocaleString() : "-"}</dd></div><div><dt>{t("Reference")}</dt><dd className="mono-reference">{request.rendition?.beneficiaryAcknowledgment?.reference || "-"}</dd></div></dl>}
    </Section>

    {editable && <form className="rendition-submit-bar" onSubmit={submit}><label className="field"><span>{files.map(file => file.name).join(", ")} {t("Rendition evidence")}{isAdvance ? " *" : ""}</span><input type="file" multiple required={isAdvance && !files.length && !request.attachments?.some((item) => item.kind === "RENDITION")} onChange={(event) => setFiles(Array.from(event.target.files || []))} /></label><label className="field"><span>{t("Comments")}</span><textarea rows="2" value={comments} onChange={(event) => setComments(event.target.value)} /></label><button type="submit" className="primary-button" disabled={processing || !acknowledged || Math.abs(difference) >= 0.01 || Math.abs(balance) >= 0.01 || (unsupportedLines.length > 0 && !exceptionalUse) || (isReimbursement && !selectedBank)}><Send size={16} />{t(processing ? "Submitting..." : "Submit rendition")}</button></form>}

    <Section icon={CheckCircle2} title="Finance Review" description="Accounting/Admin owns the review result and timestamp.">
      <div className="finance-review-row"><div><span>{t("Result")}</span><StatusBadge status={request.rendition?.financeReview?.result || "PENDING"} /></div><div><span>{t("Reviewed")}</span><strong>{request.rendition?.financeReview?.reviewedAt ? new Date(request.rendition.financeReview.reviewedAt).toLocaleString() : "-"}</strong></div><div><span>{t("Comments")}</span><strong>{request.rendition?.financeReview?.comments || "-"}</strong></div>{canReview && <div className="action-buttons"><button type="button" className="primary-button" onClick={() => setConfirm({ action: "approve", title: "Approve rendition?", description: isAdvance ? "Finance approval posts the existing rendition journal and clears the advance transit account." : "Finance approval permits the existing non-deductible Accounting process; it does not execute payment.", confirmLabel: "Approve rendition" })}><CheckCircle2 size={16} />{t("Approve")}</button><button type="button" className="secondary-button" onClick={() => setConfirm({ action: "observe", title: "Observe rendition?", description: "Return the official details for correction while preserving the RG and history.", confirmLabel: "Observe rendition", inputLabel: "Observation comments", inputRequired: true })}><MessageSquareWarning size={16} />{t("Observe")}</button><button type="button" className="danger-button subtle" onClick={() => setConfirm({ action: "reject", title: "Reject rendition?", description: "Reject the Finance review and preserve a distinct audited result.", confirmLabel: "Reject rendition", inputLabel: "Rejection comments", inputRequired: true, tone: "danger" })}><XCircle size={16} />{t("Reject")}</button></div>}</div>
    </Section>
    </fieldset>
    <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={(reviewComments) => review(confirm.action, reviewComments)} />
  </div>;
}
