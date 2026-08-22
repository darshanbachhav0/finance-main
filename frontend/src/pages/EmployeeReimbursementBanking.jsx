import { BadgeCheck, Landmark, Pencil, Plus, Power, Star } from "lucide-react";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

const emptyForm = { bank: "BCP", currency: "PEN", accountHolderName: "", accountNumber: "", cci: "", preferred: true };
const banks = ["BCP", "BBVA", "INTERBANK", "SCOTIABANK", "BANCO_NACION"];

export default function EmployeeReimbursementBanking() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [drawer, setDrawer] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [confirm, setConfirm] = useState(null);
  const canManage = ["Admin", "Solicitor"].includes(user.role);
  const canReview = ["Admin", "Accounting"].includes(user.role);

  async function load() {
    setLoading(true);
    try {
      const response = await api.get("/employee-bank-accounts");
      setRows(response.data.data || []);
      setError("");
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openForm(row = null) {
    setEditing(row);
    setForm(row ? { bank: row.bank, currency: row.currency, accountHolderName: row.accountHolderName || row.user?.name || "", accountNumber: row.accountNumber || "", cci: row.cci || "", preferred: row.preferred } : { ...emptyForm, accountHolderName: user.name });
    setDrawer(true);
  }

  async function save(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      if (editing) await api.patch(`/employee-bank-accounts/${editing._id}`, form);
      else await api.post("/employee-bank-accounts", form);
      notify(editing ? "Bank facts changed. The historical profile was retained and a new pending profile was created." : "Reimbursement bank profile created for Finance review.");
      setDrawer(false);
      await load();
    } catch (err) { setError(err.message); notify(err.message, "error"); }
    finally { setProcessing(false); }
  }

  async function runConfirm(comments) {
    setProcessing(true);
    try {
      if (confirm.action === "preferred") await api.post(`/employee-bank-accounts/${confirm.row._id}/preferred`);
      if (confirm.action === "deactivate") await api.delete(`/employee-bank-accounts/${confirm.row._id}`);
      if (["VERIFIED", "OBSERVED", "REJECTED"].includes(confirm.action)) await api.post(`/employee-bank-accounts/${confirm.row._id}/review`, { result: confirm.action, comments });
      notify(confirm.success);
      setConfirm(null);
      await load();
    } catch (err) { setError(err.message); notify(err.message, "error"); setConfirm(null); }
    finally { setProcessing(false); }
  }

  const actions = (row) => {
    const items = [];
    if (canManage && row.active) items.push({ label: "Edit bank facts", icon: Pencil, onClick: () => openForm(row) });
    if (canManage && row.active && !row.preferred) items.push({ label: "Make preferred", icon: Star, onClick: () => setConfirm({ action: "preferred", row, title: "Make this account preferred?", description: "The previous preferred account remains in history and is no longer selected for new reimbursements.", confirmLabel: "Make preferred", success: "Preferred reimbursement account updated." }) });
    if (canReview && row.active && row.verificationStatus !== "VERIFIED") items.push({ label: "Verify manually", icon: BadgeCheck, onClick: () => setConfirm({ action: "VERIFIED", row, title: "Verify this employee bank profile?", description: "This records an authorized manual UMA Finance review. It is not external bank verification.", confirmLabel: "Verify profile", inputLabel: "Review comments", success: "Employee reimbursement bank profile verified." }) });
    if (canReview && row.active) items.push({ label: "Observe", icon: Pencil, onClick: () => setConfirm({ action: "OBSERVED", row, title: "Observe this employee bank profile?", description: "Return the banking facts for correction with mandatory Finance comments.", confirmLabel: "Observe profile", inputLabel: "Observation comments", inputRequired: true, success: "Employee bank profile observed." }) });
    if (canReview && row.active) items.push({ label: "Reject", icon: Power, destructive: true, onClick: () => setConfirm({ action: "REJECTED", row, title: "Reject this employee bank profile?", description: "The profile stays in history and cannot be used for reimbursement.", confirmLabel: "Reject profile", inputLabel: "Rejection comments", inputRequired: true, tone: "danger", success: "Employee bank profile rejected." }) });
    if (canManage && row.active) items.push({ label: "Deactivate", icon: Power, destructive: true, onClick: () => setConfirm({ action: "deactivate", row, title: "Deactivate this employee bank profile?", description: "The profile remains in history and cannot remain preferred.", confirmLabel: "Deactivate profile", tone: "danger", success: "Employee reimbursement bank profile deactivated." }) });
    return items;
  };

  return <section>
    <PageHeader title="Employee Reimbursement Banking" description="Protected employee payment destinations, verification, preference, and retained history." actions={canManage && <button type="button" className="primary-button" onClick={() => openForm()}><Plus size={16} />{t("Add bank profile")}</button>} />
    <Message type="error">{error}</Message>
    <div className="workspace-panel"><div className="section-heading"><div><h3>{t("Reimbursement bank profiles")}</h3><p>{t(user.role === "Treasury" ? "Read-only payment-destination access for Treasury operations." : "New and changed profiles remain pending until authorized manual Finance review.")}</p></div><Landmark size={20} /></div>
      <DataTable tableId="employee-reimbursement-banking" rows={rows} loading={loading} rowActions={actions} filters={[{ key: "verificationStatus", label: "Verification", options: ["PENDING", "VERIFIED", "OBSERVED", "REJECTED"] }, { key: "active", label: "Status", options: [{ value: true, label: "Active" }, { value: false, label: "Inactive" }] }]} columns={[
        { key: "user", label: "Employee", getValue: (row) => row.user?.name || "", render: (row) => <div className="primary-cell"><strong>{row.user?.name || user.name}</strong><span>{row.user?.employeeCode || user.employeeCode}</span></div> },
        { key: "bank", label: "Bank" },
        { key: "currency", label: "Currency" },
        { key: "accountNumberMasked", label: "Account Number", render: (row) => <span className="mono-reference">{row.accountNumberMasked || "-"}</span> },
        { key: "cciMasked", label: "CCI", render: (row) => <span className="mono-reference">{row.cciMasked || "-"}</span> },
        { key: "verificationStatus", label: "Verification", render: (row) => <StatusBadge status={row.verificationStatus} /> },
        { key: "preferred", label: "Preferred", render: (row) => row.preferred ? <Star size={16} className="text-warning" /> : "-" },
        { key: "active", label: "Status", render: (row) => <StatusBadge status={row.active ? "ACTIVE" : "INACTIVE"} /> },
        { key: "validFrom", label: "Valid From", render: (row) => row.validFrom?.slice(0, 10) || "-" }
      ]} />
    </div>
    <Drawer open={drawer} title={editing ? "Change reimbursement bank facts" : "Add reimbursement bank profile"} description={editing ? "Changing verified facts retains the old profile and creates a new pending version." : "Only Finance/Admin can set verification status."} onClose={() => !processing && setDrawer(false)} footer={<><button type="button" className="secondary-button" onClick={() => setDrawer(false)} disabled={processing}>{t("Cancel")}</button><button type="submit" form="employee-bank-form" className="primary-button" disabled={processing}>{t(processing ? "Saving..." : "Save profile")}</button></>}>
      <form id="employee-bank-form" className="form-grid two-column-form" onSubmit={save}><label className="field"><span>{t("Bank")} *</span><select required value={form.bank} onChange={(event) => setForm({ ...form, bank: event.target.value })}>{banks.map((bank) => <option key={bank} value={bank}>{t(bank)}</option>)}</select></label><label className="field"><span>{t("Currency")} *</span><select required value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value })}><option value="PEN">PEN</option><option value="USD">USD</option></select></label><label className="field form-span-two"><span>{t("Account holder name")} *</span><input required value={form.accountHolderName} onChange={(event) => setForm({ ...form, accountHolderName: event.target.value })} /></label><label className="field"><span>{t("Account Number")} *</span><input required inputMode="numeric" value={form.accountNumber} onChange={(event) => setForm({ ...form, accountNumber: event.target.value })} /></label><label className="field"><span>{t("CCI")} *</span><input required inputMode="numeric" minLength="20" maxLength="24" value={form.cci} onChange={(event) => setForm({ ...form, cci: event.target.value })} /><small className="field-hint">{t("CCI must contain exactly 20 digits after formatting is removed.")}</small></label>{!editing && <label className="checkbox-row form-span-two"><input type="checkbox" checked={form.preferred} onChange={(event) => setForm({ ...form, preferred: event.target.checked })} /><span>{t("Use as preferred account for new reimbursements")}</span></label>}</form>
    </Drawer>
    <ConfirmDialog open={Boolean(confirm)} {...confirm} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={runConfirm} />
  </section>;
}
