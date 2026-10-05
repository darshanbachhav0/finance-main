import useWorkDraft, { useDraftResume } from "../hooks/useWorkDraft.js";
import DraftPanel from "../components/DraftPanel.jsx";
import { useEffect, useState } from "react";
import { Lock, Pencil, RotateCw } from "lucide-react";
import api from "../api/client.js";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import { ListSkeleton } from "./WorkspaceSkeleton.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";
import { BUDGET_MONTHS, BUDGET_PLANNING_MODES, budgetCents, distributeAnnualBudget } from "../../../shared/budgetPlanning.mjs";

const initial = (year) => ({ year, costCenter: "", project: "", planningMode: "ANNUAL_ONLY", assignedAmount: "", distribution: "EQUAL", months: Array(12).fill("0"), reason: "" });
const adjustmentForm = (action = "TRANSFER") => ({ operationId: crypto.randomUUID(), action, fromMonth: "1", toMonth: "2", amount: "", planningMode: "ANNUAL_MONTHLY", distribution: "USAGE", reason: "" });
const cents = (value) => { try { return budgetCents(value); } catch { return null; } };
// A month can never be set below what it already committed plus spent.
const usedIn = (bucket) => Math.round(((bucket.committedAmount || 0) + (bucket.executedAmount || 0)) * 100);

export const ADJUSTMENT_LABELS = {
  CREATED: "Budget created", TRANSFER: "Transfer between months", ALLOCATE_RESERVE: "Allocate annual reserve", INCREASE: "Annual increase",
  EXCEPTION_INCREASE: "Increase from approved budget exception", CARRY_OVER_OUT: "Carried over to next year", CARRY_OVER_IN: "Carried over from previous year",
  REDISTRIBUTE: "Monthly distribution edited", RELEASE_TO_RESERVE: "Returned to annual reserve", DECREASE: "Annual decrease",
  MODE_CHANGE: "Planning mode changed", ROLL_FORWARD: "Automatic roll-forward", SETTINGS: "Roll-forward setting changed"
};
const ACTION_HINTS = {
  TRANSFER: "Only unused budget can be moved. The annual total remains unchanged.",
  ALLOCATE_RESERVE: "Allocate part of the undistributed annual amount to the selected month.",
  RELEASE_TO_RESERVE: "Move unused budget of a month back to the annual reserve.",
  INCREASE: "Record the approval reference. For monthly plans, the increase remains pending allocation until assigned to a month.",
  DECREASE: "Monthly plans can remove only the annual reserve; annual-only plans only their unused budget.",
  MODE_CHANGE: "Switching to monthly control splits the year across months; switching to annual-only removes the monthly limits.",
  SETTINGS: "When a month ends, its unused budget moves to the next month automatically. Only month ends after this change roll; December never rolls."
};

// Describes a pending/decided plan change in the reader's language from its stored payload.
export function changeDescription(change, t, money) {
  const payload = change?.payload || {};
  const month = (value) => t(BUDGET_MONTHS[value - 1]);
  switch (payload.action || change?.action) {
    case "TRANSFER": return t("Transfer {amount} from {from} to {to}").replace("{amount}", money(payload.amount)).replace("{from}", month(payload.fromMonth)).replace("{to}", month(payload.toMonth));
    case "ALLOCATE_RESERVE": return t("Allocate {amount} of the annual reserve to {to}").replace("{amount}", money(payload.amount)).replace("{to}", month(payload.toMonth));
    case "RELEASE_TO_RESERVE": return t("Return {amount} of {from} to the annual reserve").replace("{amount}", money(payload.amount)).replace("{from}", month(payload.fromMonth));
    case "INCREASE": return t("Increase the annual budget by {amount}").replace("{amount}", money(payload.amount));
    case "DECREASE": return t("Decrease the annual budget by {amount}").replace("{amount}", money(payload.amount));
    case "REDISTRIBUTE": return t("Edit the monthly distribution");
    case "MODE_CHANGE": return t(payload.planningMode === "ANNUAL_MONTHLY" ? "Switch to annual + monthly control" : "Switch to annual-only control");
    case "SETTINGS": return t(payload.rollForward ? "Turn on automatic roll-forward" : "Turn off automatic roll-forward");
    default: return change?.summary || "";
  }
}

export default function BudgetPlanWorkspace({ open, planId, year, selectedPeriod, canManage, canEdit = false, onClose, onSaved }) {
  const { t, language } = useLanguage();
  const { notify } = useToast();
  const money = (value) => value === null || value === undefined ? "—" : formatCurrency(value, "PEN", language);
  const [form, setForm] = useState(() => initial(year));
  const [adjustment, setAdjustment] = useState(() => adjustmentForm());
  const [plan, setPlan] = useState(null);
  const [masters, setMasters] = useState({ centers: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showAdjustment, setShowAdjustment] = useState(false);
  // Monthly grid editor: twelve editable amounts plus one reason, saved as one redistribution.
  const [grid, setGrid] = useState(null);
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(""); setNotice(""); setPlan(null); setShowAdjustment(false); setGrid(null); setForm(initial(year)); setAdjustment(adjustmentForm());
    const fetchAll = async (path) => {
      const rows = [];
      for (let page = 1; ; page += 1) {
        const response = await api.get(path, { params: { pageSize: 100, page, active: true } });
        rows.push(...response.data.data);
        if (!response.data.pagination || page >= response.data.pagination.totalPages) return rows;
      }
    };
    (async () => {
      try {
        if (planId) { const response = await api.get(`/budget/plans/${planId}`); if (active) { setPlan(response.data.data); if (new URLSearchParams(window.location.search).get("workScope") === "budget-adjustment") setShowAdjustment(true); } }
        else {
          const centers = await fetchAll("/cost-centers");
          if (active) setMasters({ centers });
        }
      } catch (err) { if (active) setError(err.message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [open, planId, year]);

  const draft = useWorkDraft({ scope: "budget-plan", title: "Annual budget plan", enabled: open && !loading && !planId && !plan && canManage, value: form, restore: setForm });
  const adjustmentDraft = useWorkDraft({ scope: "budget-adjustment", recordId: plan?._id || planId || "new", title: "Budget adjustment", enabled: open && !loading && Boolean(plan) && canEdit && showAdjustment, value: adjustment, restore: setAdjustment, sourceVersion: plan?.updatedAt });
  useDraftResume("budget-adjustment", () => setShowAdjustment(true));

  let monthlyAmounts = form.months;
  let distributionError = "";
  let unallocated = null;
  if (form.planningMode === "ANNUAL_MONTHLY" && form.assignedAmount !== "") {
    try {
      monthlyAmounts = form.distribution === "EQUAL" ? distributeAnnualBudget(form.assignedAmount) : form.months;
      unallocated = (budgetCents(form.assignedAmount) - monthlyAmounts.reduce((sum, value) => sum + budgetCents(value), 0)) / 100;
      if (unallocated < 0) distributionError = "Monthly allocations cannot exceed the annual budget.";
    } catch (err) { distributionError = err.message; }
  }

  async function savePlan(event) {
    event.preventDefault(); if (!draft.ready || draft.status === "conflict") return;
    if (distributionError) { setError(distributionError); return; }
    setSaving(true); setError("");
    try {
      const response = await api.post("/budget/plans", { ...form, months: monthlyAmounts });
      await draft.complete();
      setPlan(response.data.data);
      onSaved(response.data.data);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  // Applied changes refresh the plan; changes above the approval threshold wait for Management.
  function afterChange(saved) {
    setPlan(saved);
    onSaved(saved);
    if (saved.submittedForApproval) {
      setNotice("The change moves more than the approval threshold. It was sent to Management and applies once approved.");
      notify("Budget change sent to Management for approval.");
    } else {
      setNotice("");
      notify("Budget plan updated.");
    }
  }
  async function refreshAfterError(err) {
    setError(err.message);
    try { setPlan((await api.get(`/budget/plans/${plan._id}`)).data.data); } catch { /* Preserve the original error. */ }
  }

  async function saveAdjustment(event) {
    event.preventDefault(); if (!adjustmentDraft.ready || adjustmentDraft.status === "conflict") return;
    setSaving(true); setError("");
    try {
      const response = await api.post(`/budget/plans/${plan._id}/adjustments`, { ...adjustment, planningMode: adjustment.action === "MODE_CHANGE" ? (monthly ? "ANNUAL_ONLY" : "ANNUAL_MONTHLY") : undefined, rollForward: adjustment.action === "SETTINGS" ? !plan.rollForward?.enabled : undefined, revision: plan.__v });
      await adjustmentDraft.complete();
      setShowAdjustment(false); setAdjustment(adjustmentForm());
      afterChange(response.data.data);
    } catch (err) { await refreshAfterError(err); } finally { setSaving(false); }
  }

  function openGrid() {
    setShowAdjustment(false);
    setGrid({ operationId: crypto.randomUUID(), months: plan.months.map((bucket) => String(bucket.assignedAmount)), reason: "" });
  }
  // Live checks mirror the server rules so problems show before saving.
  const gridRows = grid && plan ? plan.months.map((bucket, index) => {
    const value = cents(grid.months[index]);
    const floor = usedIn(bucket);
    const before = Math.round(bucket.assignedAmount * 100);
    return { bucket, value, floor, before, invalid: value === null, belowFloor: value !== null && value < floor, changed: value !== null && value !== before };
  }) : [];
  const gridTotal = gridRows.reduce((sum, row) => sum + (row.value || 0), 0);
  const gridAnnual = plan ? Math.round(plan.assignedAmount * 100) : 0;
  const gridProblems = grid ? [
    ...gridRows.filter((row) => row.invalid).map((row) => `${t(BUDGET_MONTHS[row.bucket.month - 1])}: ${t("Enter a valid budget amount with at most two decimal places.")}`),
    ...gridRows.filter((row) => row.belowFloor).map((row) => `${t(BUDGET_MONTHS[row.bucket.month - 1])}: ${t("cannot go below what it has already committed and spent")} (${money(row.floor / 100)})`),
    ...(gridTotal > gridAnnual ? [t("The months add up to more than the annual budget.")] : [])
  ] : [];
  const gridChanged = gridRows.filter((row) => row.changed).length;

  async function saveGrid(event) {
    event.preventDefault();
    if (gridProblems.length || !gridChanged) return;
    setSaving(true); setError("");
    try {
      const response = await api.post(`/budget/plans/${plan._id}/adjustments`, { operationId: grid.operationId, action: "REDISTRIBUTE", months: grid.months.map((value) => String(value).trim()), reason: grid.reason, revision: plan.__v });
      setGrid(null);
      afterChange(response.data.data);
    } catch (err) { await refreshAfterError(err); } finally { setSaving(false); }
  }

  async function withdraw(change) {
    setSaving(true); setError("");
    try {
      await api.post(`/budget/plan-changes/${change._id}/cancel`);
      const response = await api.get(`/budget/plans/${plan._id}`);
      setPlan(response.data.data);
      notify("Budget change withdrawn.");
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }

  const monthly = plan?.planningMode === "ANNUAL_MONTHLY";
  const closed = new Set(plan?.closedMonths || []);
  const monthOptions = BUDGET_MONTHS.map((name, index) => <option key={name} value={index + 1}>{t(name)}{closed.has(index + 1) ? ` · ${t("closed period")}` : ""}</option>);
  const actionOptions = plan ? [
    ...(monthly ? ["TRANSFER", "ALLOCATE_RESERVE", "RELEASE_TO_RESERVE"] : []),
    "INCREASE", "DECREASE", "MODE_CHANGE",
    ...(monthly ? ["SETTINGS"] : [])
  ] : [];
  const actionLabel = (action) => action === "SETTINGS" ? (plan?.rollForward?.enabled ? "Turn off automatic roll-forward" : "Turn on automatic roll-forward") : action === "MODE_CHANGE" ? (monthly ? "Switch to annual-only control" : "Switch to annual + monthly control") : action === "DECREASE" ? "Decrease annual budget" : action === "INCREASE" ? "Record approved annual increase" : ADJUSTMENT_LABELS[action];
  const touchedMonths = (entry) => entry.monthChanges?.length ? entry.monthChanges.map((item) => `${t(BUDGET_MONTHS[item.month - 1])} ${money(item.before)} → ${money(item.after)}`).join(" · ") : `${entry.fromMonth ? `${t(BUDGET_MONTHS[entry.fromMonth - 1])} → ` : ""}${entry.toMonth ? t(BUDGET_MONTHS[entry.toMonth - 1]) : ""}`;

  return <Drawer open={open} title={planId || plan ? "Annual budget plan" : "Create annual budget"} size="large" onClose={() => !saving && onClose()}>
    <Message type="error">{t(error)}</Message>
    {notice && <Message>{t(notice)}</Message>}
    {loading ? <div role="status"><span className="sr-only">{t("Loading...")}</span><ListSkeleton rowCount={4} columnCount={3} /></div> : plan ? <>
      <div className="budget-plan-heading"><div><strong>{plan.period} · {plan.costCenter?.code}</strong><p>{plan.costCenter?.name}{plan.project ? ` / ${plan.project}` : ""}</p></div><span className="budget-mode-tag">{t(BUDGET_PLANNING_MODES[plan.planningMode])}</span></div>
      <dl className="budget-plan-metrics">
        <div><dt>{t("Annual budget")}</dt><dd>{money(plan.assignedAmount)}</dd></div>
        <div><dt>{t("Annual available")}</dt><dd>{money(plan.availableAmount)}</dd></div>
        {plan.unallocatedAmount !== null && <div><dt>{t("Pending allocation")}</dt><dd>{money(plan.unallocatedAmount)}</dd></div>}
        {monthly && <div><dt>{t("Automatic roll-forward")}</dt><dd><RotateCw size={14} aria-hidden="true" /> {t(plan.rollForward?.enabled ? "On" : "Off")}</dd></div>}
      </dl>
      {plan.pendingChanges?.length > 0 && <div className="budget-pending-changes" role="status">
        <strong>{t("Waiting for Management approval")}</strong>
        {plan.pendingChanges.map((item) => <div className="budget-pending-change" key={item._id}><span>{changeDescription(item, t, money)} · {money(item.amount)}</span><small>{item.requestedByName} · {formatDateTime(item.createdAt, language)}</small>{canEdit && <button type="button" className="text-button" disabled={saving} onClick={() => withdraw(item)}>{t("Withdraw")}</button>}</div>)}
      </div>}
      {monthly && <><div className="budget-allocation-caption"><span>{t("Distributed to months")}: {money(plan.distributedAmount)}</span><span>{t("Pending allocation")}: {money(plan.unallocatedAmount)}</span></div><div className="budget-allocation-meter" role="meter" aria-label={t("Distributed to months")} aria-valuemin={0} aria-valuemax={plan.assignedAmount} aria-valuenow={plan.distributedAmount}><span style={{ width: `${plan.assignedAmount ? Math.min(100, plan.distributedAmount / plan.assignedAmount * 100) : 0}%` }} /></div></>}
      <div className="section-heading"><div><h3>{t("Monthly distribution and activity")}</h3><p>{t(plan.planningMode === "ANNUAL_ONLY" ? "Monthly activity is tracked against the annual limit." : "Each request must fit both the annual and monthly limits. Unused amounts stay in their month until moved.")}</p></div>
        {canEdit && !grid && !showAdjustment && <div className="budget-form-actions">
          {monthly && <button className="primary-button" type="button" onClick={openGrid}><Pencil size={15} /><span>{t("Edit distribution")}</span></button>}
          <button className="secondary-button" type="button" onClick={() => { setGrid(null); setShowAdjustment(true); setAdjustment(adjustmentForm(monthly ? "TRANSFER" : "INCREASE")); }}>{t("Adjust budget")}</button>
        </div>}
      </div>
      {!grid && <div className="budget-month-cards">{plan.months.map(bucket => <article key={bucket.month}><strong>{t(BUDGET_MONTHS[bucket.month - 1])}{closed.has(bucket.month) && <Lock size={12} aria-label={t("closed period")} />}</strong><span>{t("Available")}: {money(bucket.availableAmount)}</span><details><summary>{t("Details")}</summary><dl>{[["Assigned", monthly ? bucket.assignedAmount : null], ["Committed", bucket.committedAmount], ["Executed", bucket.executedAmount], ["Paid", bucket.paidAmount]].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{money(value)}</dd></div>)}</dl></details></article>)}</div>}
      {grid ? <form className="budget-grid-editor" onSubmit={saveGrid}>
        <div className="budget-month-table"><table><thead><tr>{["Month", "Assigned", "Minimum", "Committed", "Executed", "Available after"].map((label) => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{gridRows.map((row, index) => <tr key={row.bucket.month} className={row.belowFloor || row.invalid ? "has-error" : row.changed ? "is-changed" : ""}>
          <th scope="row">{t(BUDGET_MONTHS[row.bucket.month - 1])}{closed.has(row.bucket.month) && <span className="budget-closed-tag"><Lock size={12} aria-hidden="true" />{t("closed period")}</span>}</th>
          <td data-label={t("Assigned")}><input aria-label={`${t("Assigned")} · ${t(BUDGET_MONTHS[row.bucket.month - 1])}`} type="number" min={row.floor / 100} step="0.01" required value={grid.months[index]} onChange={(event) => setGrid((current) => ({ ...current, months: current.months.map((value, position) => position === index ? event.target.value : value) }))} /></td>
          <td data-label={t("Minimum")}>{money(row.floor / 100)}</td>
          <td data-label={t("Committed")}>{money(row.bucket.committedAmount)}</td>
          <td data-label={t("Executed")}>{money(row.bucket.executedAmount)}</td>
          <td data-label={t("Available after")} className={row.belowFloor ? "text-danger" : ""}>{row.value === null ? "—" : money((row.value - row.floor) / 100)}</td>
        </tr>)}</tbody></table></div>
        <div className="budget-grid-totals" aria-live="polite">
          <span>{t("Annual budget")}: <strong>{money(gridAnnual / 100)}</strong></span>
          <span>{t("Distributed to months")}: <strong className={gridTotal > gridAnnual ? "text-danger" : ""}>{money(gridTotal / 100)}</strong></span>
          <span>{t("Annual reserve after")}: <strong className={gridTotal > gridAnnual ? "text-danger" : ""}>{money((gridAnnual - gridTotal) / 100)}</strong></span>
          <span>{t("Months changed")}: <strong>{gridChanged}</strong></span>
        </div>
        {gridProblems.length > 0 && <Message type="error"><ul className="plain-list">{gridProblems.map((problem) => <li key={problem}>{problem}</li>)}</ul></Message>}
        {gridRows.some((row) => row.changed && closed.has(row.bucket.month)) && <Message>{t("Some changed months belong to a closed accounting period. The change is allowed for Admin and recorded in the history.")}</Message>}
        <label className="field"><span>{t("Reason / approval reference")} *</span><textarea aria-label={t("Reason / approval reference")} maxLength="2000" required rows="2" value={grid.reason} onChange={(event) => setGrid((current) => ({ ...current, reason: event.target.value }))} /></label>
        <div className="budget-form-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setGrid(null)}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={saving || gridProblems.length > 0 || !gridChanged}>{t(saving ? "Saving..." : "Save distribution")}</button></div>
      </form> : <div className="budget-month-table"><table><thead><tr>{["Month", "Assigned", "Committed", "Executed", "Paid", "Available"].map((label) => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{plan.months.map((bucket) => <tr key={bucket.month} className={selectedPeriod === `${plan.period}-${String(bucket.month).padStart(2, "0")}` ? "is-current-month" : ""}><th scope="row">{t(BUDGET_MONTHS[bucket.month - 1])}{closed.has(bucket.month) && <span className="budget-closed-tag"><Lock size={12} aria-hidden="true" />{t("closed period")}</span>}</th><td data-label={t("Assigned")}>{monthly ? money(bucket.assignedAmount) : "—"}</td><td data-label={t("Committed")}>{money(bucket.committedAmount)}</td><td data-label={t("Executed")}>{money(bucket.executedAmount)}</td><td data-label={t("Paid")}>{money(bucket.paidAmount)}</td><td data-label={t("Available")} className={bucket.availableAmount < 0 ? "text-danger" : ""}>{money(bucket.availableAmount)}</td></tr>)}</tbody></table></div>}
      {showAdjustment && canEdit && <DraftPanel busy={saving} draft={adjustmentDraft} onDiscard={() => setShowAdjustment(false)}><form className="budget-adjustment-form" onSubmit={saveAdjustment}>
        <h3>{t("Audited budget adjustment")}</h3>
        <div className="form-grid two-column-form">
          <label className="field"><span>{t("Adjustment type")}</span><select aria-label={t("Adjustment type")} value={adjustment.action} onChange={(event) => setAdjustment((current) => ({ ...current, action: event.target.value }))}>{actionOptions.map((action) => <option key={action} value={action}>{t(actionLabel(action))}</option>)}</select></label>
          {["TRANSFER", "ALLOCATE_RESERVE", "RELEASE_TO_RESERVE", "INCREASE", "DECREASE"].includes(adjustment.action) && <label className="field"><span>{t("Adjustment amount")} · PEN *</span><input aria-label={t("Adjustment amount")} type="number" min="0.01" step="0.01" required value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} /></label>}
          {["TRANSFER", "RELEASE_TO_RESERVE"].includes(adjustment.action) && <label className="field"><span>{t("From month")}</span><select aria-label={t("From month")} value={adjustment.fromMonth} onChange={(event) => setAdjustment((current) => ({ ...current, fromMonth: event.target.value }))}>{monthOptions}</select></label>}
          {["TRANSFER", "ALLOCATE_RESERVE"].includes(adjustment.action) && <label className="field"><span>{t("To month")}</span><select aria-label={t("To month")} value={adjustment.toMonth} onChange={(event) => setAdjustment((current) => ({ ...current, toMonth: event.target.value }))}>{monthOptions}</select></label>}
          {adjustment.action === "MODE_CHANGE" && !monthly && <label className="field"><span>{t("Monthly distribution")}</span><select aria-label={t("Monthly distribution")} value={adjustment.distribution} onChange={(event) => setAdjustment((current) => ({ ...current, distribution: event.target.value }))}><option value="USAGE">{t("Keep current usage per month; the rest stays in reserve")}</option><option value="EQUAL">{t("Distribute equally")}</option></select></label>}
          <label className="field form-span-two"><span>{t("Reason / approval reference")} *</span><textarea aria-label={t("Reason / approval reference")} maxLength="2000" required rows="2" value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} /></label>
        </div>
        <p>{t(ACTION_HINTS[adjustment.action])}</p>
        <div className="budget-form-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setShowAdjustment(false)}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={saving}>{t(saving ? "Saving..." : "Save adjustment")}</button></div>
      </form></DraftPanel>}
      <h3 className="section-spacer">{t("Budget adjustment history")}</h3>
      <div className="budget-history">{[...plan.adjustments].reverse().map((entry) => <article key={entry.operationId}><div><strong>{t(ADJUSTMENT_LABELS[entry.action] || entry.action)}{entry.amount ? ` · ${money(entry.amount)}` : ""}</strong><span>{entry.action === "MODE_CHANGE" ? `${t(BUDGET_PLANNING_MODES[entry.modeBefore] || entry.modeBefore)} → ${t(BUDGET_PLANNING_MODES[entry.modeAfter] || entry.modeAfter)}` : entry.action === "SETTINGS" ? t(entry.rollForwardEnabled ? "On" : "Off") : touchedMonths(entry)}</span></div><p>{entry.reason}</p><small>{entry.actorName} · {formatDateTime(entry.at, language)}{entry.approvedByName ? ` · ${t("Approved by")} ${entry.approvedByName}` : ""}{entry.closedMonths?.length ? ` · ${t("closed period")}: ${entry.closedMonths.map((value) => t(BUDGET_MONTHS[value - 1])).join(", ")}` : ""}</small></article>)}</div>
    </> : !planId && canManage && <DraftPanel busy={saving} draft={draft} onDiscard={onClose}><form onSubmit={savePlan} className="budget-plan-form">
      <p>{t("Create a yearly budget for a Cost Center and optional project. Any request from that Cost Center draws on it. Existing allocations and recorded activity remain unchanged.")}</p>
      <div className="form-grid two-column-form">
        <label className="field"><span>{t("Budget year")} *</span><input aria-label={t("Budget year")} type="number" min="2000" max="2199" step="1" required value={form.year} onChange={(event) => change("year", event.target.value)} /></label>
        <label className="field"><span>{t("Budget planning mode")}</span><select aria-label={t("Budget planning mode")} value={form.planningMode} onChange={(event) => change("planningMode", event.target.value)}>{Object.entries(BUDGET_PLANNING_MODES).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
        <label className="field"><span>{t("Cost center")} *</span><select aria-label={t("Cost center")} required value={form.costCenter} onChange={(event) => change("costCenter", event.target.value)}><option value="">{t("Select")}</option>{masters.centers.map((center) => <option key={center._id} value={center._id}>{center.code} · {center.name}</option>)}</select></label>
        <label className="field"><span>{t("Project")}</span><input aria-label={t("Project")} maxLength="150" value={form.project} onChange={(event) => change("project", event.target.value)} /></label>
        <label className="field"><span>{t("Annual budget")} · PEN *</span><input aria-label={t("Annual budget")} type="number" min="0.01" step="0.01" required value={form.assignedAmount} onChange={(event) => change("assignedAmount", event.target.value)} /></label>
      </div>
      {form.planningMode === "ANNUAL_MONTHLY" && <div className="budget-distribution-editor">
        <label className="field"><span>{t("Monthly distribution")}</span><select aria-label={t("Monthly distribution")} value={form.distribution} onChange={(event) => { const distribution = event.target.value; setForm((current) => ({ ...current, distribution, months: distribution === "CUSTOM" && current.assignedAmount && !distributionError ? monthlyAmounts.map(String) : current.months })); }}><option value="EQUAL">{t("Distribute equally")}</option><option value="CUSTOM">{t("Custom distribution")}</option></select></label>
        <div className="budget-month-inputs">{BUDGET_MONTHS.map((name, index) => <label className="field" key={name}><span>{t(name)}</span><input aria-label={t(name)} type="number" min="0" step="0.01" required readOnly={form.distribution === "EQUAL"} value={monthlyAmounts[index]} onChange={(event) => change("months", form.months.map((value, current) => current === index ? event.target.value : value))} /></label>)}</div>
        <div className="budget-reserve-preview" aria-live="polite"><span>{t("Pending allocation")}</span><strong className={unallocated < 0 ? "text-danger" : ""}>{money(unallocated)}</strong></div>
        {distributionError && <Message type="error">{t(distributionError)}</Message>}
      </div>}
      <label className="field"><span>{t("Reason / approval reference")} *</span><textarea aria-label={t("Reason / approval reference")} maxLength="2000" required rows="2" value={form.reason} onChange={(event) => change("reason", event.target.value)} /></label>
      <div className="budget-form-actions"><button type="button" className="secondary-button" onClick={onClose}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={saving || Boolean(distributionError)}>{t(saving ? "Saving..." : "Create budget plan")}</button></div>
    </form></DraftPanel>}
  </Drawer>;
}
