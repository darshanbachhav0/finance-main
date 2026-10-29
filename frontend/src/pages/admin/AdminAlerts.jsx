import { RefreshCw } from "lucide-react";
import { useState } from "react";
import DataTable from "../../components/DataTable.jsx";
import DeepLinkNotice from "../../components/DeepLinkNotice.jsx";
import Drawer from "../../components/Drawer.jsx";
import Message from "../../components/Message.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import useDeepLink from "../../hooks/useDeepLink.js";
import usePaginatedResource from "../../hooks/usePaginatedResource.js";
import AuditEntryDetails from "./AuditEntryDetails.jsx";
import { auditSubject, securityAlertLabels } from "../../utils/superAdmin.js";
import { formatDateTime } from "../../utils/formatters.js";
import "../../styles/superAdmin.css";

// Sensitive changes made by administrators. Each one also reached the administrators' bell when it
// happened.
export default function AdminAlerts() {
  const { t, language } = useLanguage();
  const deepLink = useDeepLink(["record"]);
  const table = usePaginatedResource("/administration/alerts", { fixedParams: deepLink.link, deepLink: deepLink.active, initialFilters: { kind: "" }, persistKey: "super-admin-alerts" });
  const [selected, setSelected] = useState(null);
  const kindOptions = Object.entries(securityAlertLabels).map(([value, label]) => ({ value, label }));

  return (
    <section className="super-admin-page">
      <PageHeader
        title="Security alerts"
        description="Reopened accounting periods, changes to approval rules, bank formats and permissions, and finance roles given."
        actions={<button type="button" className="secondary-button" onClick={table.reload} disabled={table.loading}><RefreshCw className={table.loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>}
      />
      {deepLink.active && <DeepLinkNotice title="Showing the alert from your notification" missing={!table.loading && !table.rows.length} missingDescription="This alert could not be found." clearLabel="Show all alerts" onClear={deepLink.clear} />}
      <Message type="error">{table.error}</Message>
      <div className="workspace-panel">
        <DataTable
          rows={table.rows}
          loading={table.loading}
          remote={table.remote}
          filters={[{ key: "kind", label: "Alert", allLabel: "All alerts", options: kindOptions }]}
          searchPlaceholder="Search alerts..."
          onRowClick={setSelected}
          rowActions={(row) => [{ label: "View details", primary: true, onClick: () => setSelected(row) }]}
          emptyTitle="No security alerts"
          emptyDescription="Sensitive administrator changes will appear here."
          columns={[
            { key: "createdAt", label: "When", render: (row) => formatDateTime(row.createdAt, language) },
            { key: "kind", label: "Alert", render: (row) => <span className="badge badge-warning"><span className="badge-label">{t(securityAlertLabels[row.kind] || row.kind)}</span></span> },
            { key: "actorName", label: "Who", render: (row) => <div className="primary-cell"><strong>{row.actorName || t("System")}</strong><span>{t(row.role || "")}</span></div> },
            { key: "subject", label: "Record", sortable: false, render: (row) => auditSubject(row) || "-" },
            { key: "comments", label: "Comment", sortable: false, render: (row) => row.comments || row.message || "-" }
          ]}
        />
      </div>
      <Drawer open={Boolean(selected)} size="large" title={selected ? securityAlertLabels[selected.kind] || selected.kind : "Alert"} description={selected ? formatDateTime(selected.createdAt, language) : ""} onClose={() => setSelected(null)}>
        {selected && <AuditEntryDetails entry={selected} />}
      </Drawer>
    </section>
  );
}
