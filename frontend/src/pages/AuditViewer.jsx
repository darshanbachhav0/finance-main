import { Eye, RefreshCw } from "lucide-react";
import { useState } from "react";
import DataTable from "../components/DataTable.jsx";
import Drawer from "../components/Drawer.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";

export default function AuditViewer() {
  const { t } = useLanguage();
  const [selected, setSelected] = useState(null);
  const auditTable = usePaginatedResource("/audit", { initialPageSize: 25 });
  const { rows, loading } = auditTable;

  return <section>
    <PageHeader title="Audit Viewer" description="Read-only, insert-only history of workflow decisions, financial operations, overrides, and blocked controls." actions={<button type="button" className="secondary-button" onClick={auditTable.reload} disabled={loading}><RefreshCw className={loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>} />
    <Message type="error">{auditTable.error}</Message>
    <div className="workspace-panel"><DataTable rows={rows} loading={loading} remote={auditTable.remote} filters={[{ key: "blocked", label: "audit results", allLabel: "All results", options: [{ value: "true", label: "Blocked" }, { value: "false", label: "Completed" }] }]} searchPlaceholder="Search action, entity, user, or message..." rowActions={(row) => [{ label: "View audit details", icon: Eye, onClick: () => setSelected(row) }]} columns={[
      { key: "createdAt", label: "Timestamp", render: (row) => new Date(row.createdAt).toLocaleString() },
      { key: "module", label: "Module" },
      { key: "action", label: "Action" },
      { key: "entityType", label: "Entity" },
      { key: "entityId", label: "Record ID", render: (row) => <span className="mono-value">{row.entityId || "-"}</span> },
      { key: "user", label: "User", getValue: (row) => row.user?.name, render: (row) => <div className="primary-cell"><strong>{row.user?.name || "System"}</strong><span>{row.role || row.user?.role}</span></div> },
      { key: "blocked", label: "Result", render: (row) => <StatusBadge status={row.blocked ? "BLOCKED" : "COMPLETED"} /> },
      { key: "message", label: "Message" }
    ]} /></div>
    <Drawer open={Boolean(selected)} title="Audit event" description={selected ? `${selected.module} - ${selected.action}` : ""} onClose={() => setSelected(null)}>
      {selected && <div className="detail-stack"><dl className="detail-grid"><div><dt>{t("Timestamp")}</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd></div><div><dt>{t("IP address")}</dt><dd>{selected.ip || "-"}</dd></div><div><dt>{t("Entity")}</dt><dd>{selected.entityType}</dd></div><div><dt>{t("Record ID")}</dt><dd className="mono-value">{selected.entityId || "-"}</dd></div><div><dt>{t("Request ID")}</dt><dd className="mono-value">{selected.requestId || "-"}</dd></div><div><dt>{t("Block reason")}</dt><dd>{selected.blockReason || "-"}</dd></div></dl><div className="detail-section"><h3>{t("Recorded values")}</h3><pre className="audit-json">{JSON.stringify({ oldValues: selected.oldValues, newValues: selected.newValues, metadata: selected.metadata }, null, 2)}</pre></div></div>}
    </Drawer>
  </section>;
}
