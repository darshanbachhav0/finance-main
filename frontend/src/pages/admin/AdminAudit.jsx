import { RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import api from "../../api/client.js";
import DataTable from "../../components/DataTable.jsx";
import DateInput from "../../components/DateInput.jsx";
import Drawer from "../../components/Drawer.jsx";
import Message from "../../components/Message.jsx";
import PageHeader from "../../components/PageHeader.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import usePaginatedResource from "../../hooks/usePaginatedResource.js";
import AuditEntryDetails from "./AuditEntryDetails.jsx";
import { auditSubject } from "../../utils/superAdmin.js";
import { formatDateTime } from "../../utils/formatters.js";
import "../../styles/superAdmin.css";

// The full audit trail (append-only), filterable by administrator, module, action and dates.
export default function AdminAudit() {
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const [facets, setFacets] = useState({ modules: [], actions: [], entityTypes: [], administrators: [] });
  const [facetError, setFacetError] = useState("");
  const [range, setRange] = useState({ from: "", to: "", blocked: searchParams.get("blocked") === "true" });
  const [selected, setSelected] = useState(null);
  const fixedParams = useMemo(() => Object.fromEntries(Object.entries({ from: range.from, to: range.to, blocked: range.blocked ? "true" : "" }).filter(([, value]) => value)), [range]);
  const initialFilters = { actor: searchParams.get("actor") || "", module: searchParams.get("module") || "", action: searchParams.get("action") || "", entityType: "" };
  const table = usePaginatedResource("/administration/audit", { fixedParams, initialFilters, persistKey: "super-admin-audit", deepLink: [...searchParams.keys()].length > 0 });

  useEffect(() => {
    api.get("/administration/audit/facets").then((response) => setFacets(response.data.data)).catch((err) => setFacetError(err.message));
  }, []);

  const filters = [
    { key: "actor", label: "Administrator", allLabel: "All people", options: facets.administrators.map((person) => ({ value: person._id, label: `${person.name}${person.active === false ? ` (${t("Inactive")})` : ""}` })) },
    { key: "module", label: "Module", allLabel: "All modules", options: facets.modules },
    { key: "action", label: "Action", allLabel: "All actions", options: facets.actions },
    { key: "entityType", label: "Record type", allLabel: "All record types", options: facets.entityTypes }
  ];

  return (
    <section className="super-admin-page">
      <PageHeader
        title="Audit log"
        description="Every recorded action: who did it, where and when. Records cannot be changed or deleted."
        actions={<button type="button" className="secondary-button" onClick={table.reload} disabled={table.loading}><RefreshCw className={table.loading ? "spin" : ""} size={16} /><span>{t("Refresh")}</span></button>}
      />
      <Message type="error">{table.error || facetError}</Message>
      <div className="workspace-panel super-admin-filters">
        <label className="field"><span>{t("From")}</span><DateInput value={range.from} clearable onChange={(event) => setRange({ ...range, from: event.target.value })} /></label>
        <label className="field"><span>{t("To")}</span><DateInput value={range.to} clearable onChange={(event) => setRange({ ...range, to: event.target.value })} /></label>
        <label className="toggle-field"><input type="checkbox" checked={range.blocked} onChange={(event) => setRange({ ...range, blocked: event.target.checked })} /><span>{t("Only blocked actions")}</span></label>
      </div>
      <div className="workspace-panel section-spacer">
        <DataTable
          rows={table.rows}
          loading={table.loading}
          remote={table.remote}
          filters={filters}
          searchPlaceholder="Search person, request or message..."
          onRowClick={setSelected}
          rowActions={(row) => [{ label: "View details", primary: true, onClick: () => setSelected(row) }]}
          emptyTitle="No audit records"
          emptyDescription="Adjust the filters or the dates."
          columns={[
            { key: "createdAt", label: "When", render: (row) => formatDateTime(row.createdAt, language) },
            { key: "actorName", label: "Who", render: (row) => <div className="primary-cell"><strong>{row.actorName || t("System")}</strong><span>{t(row.role || "")}</span></div> },
            { key: "action", label: "Action", render: (row) => <div className="primary-cell"><strong>{t(row.action)}</strong><span>{t(row.module)}</span></div> },
            { key: "subject", label: "Record", sortable: false, render: (row) => [t(row.entityType), auditSubject(row)].filter(Boolean).join(" · ") },
            { key: "blocked", label: "Result", render: (row) => <span className={`badge badge-${row.blocked ? "danger" : "neutral"}`}><span className="badge-label">{t(row.blocked ? "Blocked" : "Recorded")}</span></span> },
            { key: "ip", label: "IP address", render: (row) => row.ip || "-" }
          ]}
        />
      </div>
      <Drawer open={Boolean(selected)} size="large" title={selected ? t(selected.action) : "Audit record"} description={selected ? formatDateTime(selected.createdAt, language) : ""} onClose={() => setSelected(null)}>
        {selected && <AuditEntryDetails entry={selected} />}
      </Drawer>
    </section>
  );
}
