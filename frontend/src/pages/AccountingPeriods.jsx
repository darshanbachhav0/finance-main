import { CalendarPlus, LockKeyhole, LockOpen, RefreshCw, Save } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

export default function AccountingPeriods() {
  const { t } = useLanguage();
  const { notify } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ period: new Date().toISOString().slice(0, 7), comments: "" });
  const [confirm, setConfirm] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [actionError, setActionError] = useState("");
  const periodTable = usePaginatedResource("/accounting-periods");
  const { rows, loading } = periodTable;

  async function createPeriod(event) {
    event.preventDefault();
    setProcessing(true);
    try {
      await api.post("/accounting-periods", form);
      notify("Accounting period created.");
      setCreateOpen(false);
      setActionError("");
      periodTable.reload();
    } catch (err) { setActionError(err.message); notify(err.message, "error"); } finally { setProcessing(false); }
  }

  async function changeStatus(comments) {
    setProcessing(true);
    try {
      await api.post(`/accounting-periods/${confirm.row._id}/${confirm.action}`, { comments });
      notify(confirm.action === "close" ? "Accounting period closed." : "Accounting period reopened.");
      setConfirm(null);
      setActionError("");
      periodTable.reload();
    } catch (err) { setActionError(err.message); notify(err.message, "error"); setConfirm(null); } finally { setProcessing(false); }
  }

  function requestStatusChange(row) {
    const closing = row.status === "OPEN";
    setConfirm({
      row,
      action: closing ? "close" : "reopen",
      title: closing ? "Close accounting period?" : "Reopen accounting period?",
      description: closing
        ? "The backend will first verify open transactions and a zero-difference consolidation. A closed period blocks controlled financial mutations."
        : "Reopening permits controlled workflow and accounting changes again and is recorded in the audit history.",
      confirmLabel: closing ? "Close period" : "Reopen period",
      tone: closing ? "danger" : "primary",
      inputLabel: closing ? "Closing comments" : "Reopening comments",
      inputRequired: true
    });
  }

  return <section>
    <PageHeader title="Accounting Periods" description="Open, close, and reopen fiscal periods through explicit audited controls." actions={<><button type="button" className="secondary-button" onClick={periodTable.reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button><button type="button" className="primary-button" onClick={() => setCreateOpen(true)}><CalendarPlus size={16} /><span>{t("New period")}</span></button></>} />
    <Message type="error">{actionError || periodTable.error}</Message>
    <div className="workspace-panel"><DataTable rows={rows} loading={loading} remote={periodTable.remote} filters={[{ key: "status", label: "statuses", allLabel: "All statuses", options: ["OPEN", "CLOSED"] }]} searchPlaceholder="Search accounting period..." rowActions={(row) => [{ label: row.status === "OPEN" ? "Close period" : "Reopen period", icon: row.status === "OPEN" ? LockKeyhole : LockOpen, tone: row.status === "OPEN" ? "danger" : "default", onClick: () => requestStatusChange(row) }]} columns={[
      { key: "period", label: "Period" }, { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
      { key: "openedAt", label: "Opened", render: (row) => row.openedAt ? new Date(row.openedAt).toLocaleString() : "-" }, { key: "openedBy", label: "Opened by", render: (row) => row.openedBy?.name || "-" },
      { key: "closedAt", label: "Closed", render: (row) => row.closedAt ? new Date(row.closedAt).toLocaleString() : "-" }, { key: "closedBy", label: "Closed by", render: (row) => row.closedBy?.name || "-" }, { key: "comments", label: "Comments" }
    ]} /></div>
    <Drawer open={createOpen} title="New accounting period" description="Create an open period before financial activity begins." onClose={() => !processing && setCreateOpen(false)} footer={<><button type="button" className="secondary-button" disabled={processing} onClick={() => setCreateOpen(false)}>{t("Cancel")}</button><button type="submit" form="period-form" className="primary-button" disabled={processing}><Save size={16} /><span>{t(processing ? "Saving..." : "Create")}</span></button></>}>
      <form id="period-form" className="form-grid" onSubmit={createPeriod}><label className="field"><span>{t("Period")} *</span><input type="month" required value={form.period} onChange={(event) => setForm({ ...form, period: event.target.value })} /></label><label className="field"><span>{t("Opening comments")}</span><textarea rows="4" value={form.comments} onChange={(event) => setForm({ ...form, comments: event.target.value })} /></label></form>
    </Drawer>
    <ConfirmDialog open={Boolean(confirm)} {...confirm} details={confirm ? [{ label: "Period", value: confirm.row.period }, { label: "Result", value: confirm.action === "close" ? "Status changes to CLOSED only after all financial controls pass." : "Status changes to OPEN and the action is audited." }] : []} loading={processing} onClose={() => !processing && setConfirm(null)} onConfirm={changeStatus} />
  </section>;
}
