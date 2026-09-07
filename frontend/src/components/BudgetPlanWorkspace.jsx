import { useEffect, useState } from "react";
import api from "../api/client.js";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatCurrency, formatDateTime } from "../utils/formatters.js";
import { BUDGET_MONTHS, BUDGET_PLANNING_MODES, budgetCents, distributeAnnualBudget } from "../../../shared/budgetPlanning.mjs";

const initial = (year) => ({ year, costCenter: "", expenseType: "", project: "", planningMode: "ANNUAL_ONLY", assignedAmount: "", distribution: "EQUAL", months: Array(12).fill("0"), reason: "" });
const adjustmentForm = () => ({ operationId: crypto.randomUUID(), action: "TRANSFER", fromMonth: "1", toMonth: "2", amount: "", reason: "" });

export default function BudgetPlanWorkspace({ open, planId, year, selectedPeriod, canManage, onClose, onSaved }) {
  const { t, language } = useLanguage();
  const money = (value) => value === null || value === undefined ? "—" : formatCurrency(value, "PEN", language);
  const [form, setForm] = useState(() => initial(year));
  const [adjustment, setAdjustment] = useState(adjustmentForm);
  const [plan, setPlan] = useState(null);
  const [masters, setMasters] = useState({ centers: [], expenses: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showAdjustment, setShowAdjustment] = useState(false);
  const change = (field, value) => setForm((current) => ({ ...current, [field]: value }));

  useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true); setError(""); setPlan(null); setShowAdjustment(false); setForm(initial(year)); setAdjustment(adjustmentForm());
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
        if (planId) { const response = await api.get(`/budget/plans/${planId}`); if (active) setPlan(response.data.data); }
        else {
          const [centers, expenses] = await Promise.all([fetchAll("/cost-centers"), fetchAll("/expense-types")]);
          if (active) setMasters({ centers, expenses });
        }
      } catch (err) { if (active) setError(err.message); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [open, planId, year]);

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
    event.preventDefault();
    if (distributionError) { setError(distributionError); return; }
    setSaving(true); setError("");
    try {
      const response = await api.post("/budget/plans", { ...form, months: monthlyAmounts });
      setPlan(response.data.data);
      onSaved(response.data.data);
    } catch (err) { setError(err.message); } finally { setSaving(false); }
  }
  async function saveAdjustment(event) {
    event.preventDefault(); setSaving(true); setError("");
    try {
      const response = await api.post(`/budget/plans/${plan._id}/adjustments`, { ...adjustment, revision: plan.__v });
      setPlan(response.data.data); setShowAdjustment(false); setAdjustment(adjustmentForm()); onSaved(response.data.data);
    } catch (err) {
      setError(err.message);
      // Keep the form and retry identifier while refreshing the current balances.
      try { setPlan((await api.get(`/budget/plans/${plan._id}`)).data.data); } catch { /* Preserve the original error. */ }
    } finally { setSaving(false); }
  }

  const monthOptions = BUDGET_MONTHS.map((name, index) => <option key={name} value={index + 1}>{t(name)}</option>);
  return <Drawer open={open} title={planId || plan ? "Annual budget plan" : "Create annual budget"} size="large" onClose={() => !saving && onClose()}>
    <Message type="error">{t(error)}</Message>
    {loading ? <p role="status">{t("Loading...")}</p> : plan ? <>
      <div className="budget-plan-heading"><div><strong>{plan.period} · {plan.costCenter?.code} · {plan.expenseType?.accountNumber}</strong><p>{plan.costCenter?.name} / {plan.expenseType?.name}{plan.project ? ` / ${plan.project}` : ""}</p></div><span className="budget-mode-tag">{t(BUDGET_PLANNING_MODES[plan.planningMode])}</span></div>
      <dl className="budget-plan-metrics">
        <div><dt>{t("Annual budget")}</dt><dd>{money(plan.assignedAmount)}</dd></div>
        <div><dt>{t("Annual available")}</dt><dd>{money(plan.availableAmount)}</dd></div>
        {plan.unallocatedAmount !== null && <div><dt>{t("Pending allocation")}</dt><dd>{money(plan.unallocatedAmount)}</dd></div>}
      </dl>
      {plan.planningMode === "ANNUAL_MONTHLY" && <><div className="budget-allocation-caption"><span>{t("Distributed to months")}: {money(plan.distributedAmount)}</span><span>{t("Pending allocation")}: {money(plan.unallocatedAmount)}</span></div><div className="budget-allocation-meter" role="meter" aria-label={t("Distributed to months")} aria-valuemin={0} aria-valuemax={plan.assignedAmount} aria-valuenow={plan.distributedAmount}><span style={{ width: `${Math.min(100, plan.distributedAmount / plan.assignedAmount * 100)}%` }} /></div></>}
      <div className="section-heading"><div><h3>{t("Monthly distribution and activity")}</h3><p>{t(plan.planningMode === "ANNUAL_ONLY" ? "Monthly activity is tracked against the annual limit." : "Each request must fit both the annual and monthly limits. Unused amounts stay in their month until transferred.")}</p></div>
        {canManage && !showAdjustment && <button className="secondary-button" type="button" onClick={() => { setShowAdjustment(true); setAdjustment({ ...adjustmentForm(), action: plan.planningMode === "ANNUAL_ONLY" ? "INCREASE" : "TRANSFER" }); }}>{t("Adjust budget")}</button>}
      </div>
      <div className="budget-month-table"><table><thead><tr>{["Month", "Assigned", "Committed", "Executed", "Paid", "Available"].map((label) => <th key={label}>{t(label)}</th>)}</tr></thead><tbody>{plan.months.map((bucket) => <tr key={bucket.month} className={selectedPeriod === `${plan.period}-${String(bucket.month).padStart(2, "0")}` ? "is-current-month" : ""}><th scope="row">{t(BUDGET_MONTHS[bucket.month - 1])}</th><td>{plan.planningMode === "ANNUAL_ONLY" ? "—" : money(bucket.assignedAmount)}</td><td>{money(bucket.committedAmount)}</td><td>{money(bucket.executedAmount)}</td><td>{money(bucket.paidAmount)}</td><td className={bucket.availableAmount < 0 ? "text-danger" : ""}>{money(bucket.availableAmount)}</td></tr>)}</tbody></table></div>
      {showAdjustment && canManage && <form className="budget-adjustment-form" onSubmit={saveAdjustment}>
        <h3>{t("Audited budget adjustment")}</h3>
        <div className="form-grid two-column-form">
          <label className="field"><span>{t("Adjustment type")}</span><select aria-label={t("Adjustment type")} value={adjustment.action} onChange={(event) => setAdjustment((current) => ({ ...current, action: event.target.value }))}>{plan.planningMode === "ANNUAL_MONTHLY" && <><option value="TRANSFER">{t("Transfer between months")}</option><option value="ALLOCATE_RESERVE">{t("Allocate annual reserve")}</option></>}<option value="INCREASE">{t("Record approved annual increase")}</option></select></label>
          <label className="field"><span>{t("Adjustment amount")} · PEN *</span><input aria-label={t("Adjustment amount")} type="number" min="0.01" step="0.01" required value={adjustment.amount} onChange={(event) => setAdjustment((current) => ({ ...current, amount: event.target.value }))} /></label>
          {adjustment.action === "TRANSFER" && <label className="field"><span>{t("From month")}</span><select aria-label={t("From month")} value={adjustment.fromMonth} onChange={(event) => setAdjustment((current) => ({ ...current, fromMonth: event.target.value }))}>{monthOptions}</select></label>}
          {adjustment.action !== "INCREASE" && <label className="field"><span>{t("To month")}</span><select aria-label={t("To month")} value={adjustment.toMonth} onChange={(event) => setAdjustment((current) => ({ ...current, toMonth: event.target.value }))}>{monthOptions}</select></label>}
          <label className="field form-span-two"><span>{t("Reason / approval reference")} *</span><textarea aria-label={t("Reason / approval reference")} maxLength="2000" required rows="2" value={adjustment.reason} onChange={(event) => setAdjustment((current) => ({ ...current, reason: event.target.value }))} /></label>
        </div>
        <p>{t(adjustment.action === "TRANSFER" ? "Only unused budget can be transferred. The annual total remains unchanged." : adjustment.action === "INCREASE" ? "Record the approval reference. For monthly plans, the increase remains pending allocation until assigned to a month." : "Allocate part of the undistributed annual amount to the selected month.")}</p>
        <div className="budget-form-actions"><button type="button" className="secondary-button" disabled={saving} onClick={() => setShowAdjustment(false)}>{t("Cancel")}</button><button type="submit" className="primary-button" disabled={saving}>{t(saving ? "Saving..." : "Save adjustment")}</button></div>
      </form>}
      <h3 className="section-spacer">{t("Budget adjustment history")}</h3>
      <div className="budget-history">{[...plan.adjustments].reverse().map((entry) => <article key={entry.operationId}><div><strong>{t({ CREATED: "Budget created", TRANSFER: "Transfer between months", ALLOCATE_RESERVE: "Allocate annual reserve", INCREASE: "Annual increase" }[entry.action])} · {money(entry.amount)}</strong><span>{entry.fromMonth ? `${t(BUDGET_MONTHS[entry.fromMonth - 1])} → ` : ""}{entry.toMonth ? t(BUDGET_MONTHS[entry.toMonth - 1]) : ""}</span></div><p>{entry.reason}</p><small>{entry.actorName} · {formatDateTime(entry.at, language)}</small></article>)}</div>
    </> : !planId && canManage && <form onSubmit={savePlan} className="budget-plan-form">
      <p>{t("Create a yearly budget for a Cost Center, expense account, and optional project. Existing allocations and recorded activity remain unchanged.")}</p>
      <div className="form-grid two-column-form">
        <label className="field"><span>{t("Budget year")} *</span><input aria-label={t("Budget year")} type="number" min="2000" max="2199" step="1" required value={form.year} onChange={(event) => change("year", event.target.value)} /></label>
        <label className="field"><span>{t("Budget planning mode")}</span><select aria-label={t("Budget planning mode")} value={form.planningMode} onChange={(event) => change("planningMode", event.target.value)}>{Object.entries(BUDGET_PLANNING_MODES).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label>
        <label className="field"><span>{t("Cost center")} *</span><select aria-label={t("Cost center")} required value={form.costCenter} onChange={(event) => change("costCenter", event.target.value)}><option value="">{t("Select")}</option>{masters.centers.map((center) => <option key={center._id} value={center._id}>{center.code} · {center.name}</option>)}</select></label>
        <label className="field"><span>{t("Expense account")} *</span><select aria-label={t("Expense account")} required value={form.expenseType} onChange={(event) => change("expenseType", event.target.value)}><option value="">{t("Select")}</option>{masters.expenses.map((expense) => <option key={expense._id} value={expense._id}>{expense.accountNumber} · {expense.name}</option>)}</select></label>
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
    </form>}
  </Drawer>;
}
