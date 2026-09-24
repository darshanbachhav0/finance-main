import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import Message from "../components/Message.jsx";
import PageHeader from "../components/PageHeader.jsx";
import StatCard from "../components/StatCard.jsx";
import StatusBadge from "../components/StatusBadge.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import usePaginatedResource from "../hooks/usePaginatedResource.js";
import { formatCurrency } from "../utils/formatters.js";

export default function MyTeam() {
  const { t, language } = useLanguage();
  const [team, setTeam] = useState([]);
  const [error, setError] = useState("");
  const [loadingTeam, setLoadingTeam] = useState(true);
  const requestsTable = usePaginatedResource("/requests", { fixedParams: { teamScope: true }, persistKey: "my-team-requests" });

  useEffect(() => {
    let active = true;
    api.get("/users/my-team").then((response) => { if (active) setTeam(response.data.data || []); }).catch((err) => { if (active) setError(err.message); }).finally(() => { if (active) setLoadingTeam(false); });
    return () => { active = false; };
  }, []);

  return (
    <section>
      <PageHeader title="My Team" description="People who report to you, directly, and the requests they have submitted." />
      <Message type="error">{error}</Message>
      <div className="stats-grid compact-stats">
        <StatCard label="Direct reports" value={team.length} tone="navy" />
        <StatCard label="Active requests from your team" value={team.reduce((sum, member) => sum + (member.requestCounts?.active || 0), 0)} tone="amber" />
      </div>
      <div className="workspace-panel">
        <DataTable
          rows={team}
          loading={loadingTeam}
          caption="Team members"
          columns={[
            { key: "name", primary: true, label: "Name", render: (row) => <strong>{row.name}</strong> },
            { key: "jobTitle", label: "Role / title", render: (row) => row.jobTitle || t(row.role) },
            { key: "area", label: "Area" },
            { key: "costCenter", label: "Cost center", sortable: false, render: (row) => row.costCenter ? `${row.costCenter.code} - ${row.costCenter.name}` : "-" },
            { key: "total", label: "Total requests", align: "right", render: (row) => row.requestCounts?.total ?? 0 },
            { key: "active", label: "Active requests", align: "right", render: (row) => row.requestCounts?.active ?? 0 }
          ]}
        />
      </div>
      <div className="workspace-panel">
        <DataTable
          rows={requestsTable.rows}
          loading={requestsTable.loading}
          remote={requestsTable.remote}
          caption="Requests from your team"
          searchPlaceholder="Search request, supplier, or requester..."
          columns={[
            { key: "requestNumber", label: "Request", render: (row) => <Link to={`/requests/${row._id}`}>{row.requestNumber}</Link> },
            { key: "solicitor", primary: true, label: "Requester", sortable: false, getValue: (row) => row.solicitor?.name, render: (row) => row.solicitor?.name || "-" },
            { key: "status", label: "Status", render: (row) => <StatusBadge status={row.status} /> },
            { key: "totalAmount", sortKey: "totalPENEquivalent", label: "Amount", align: "right", render: (row) => <strong>{formatCurrency(row.totalAmount || 0, row.currency, language)}</strong> },
            { key: "createdAt", label: "Submitted", render: (row) => row.createdAt ? new Date(row.createdAt).toLocaleDateString() : "-" }
          ]}
        />
      </div>
    </section>
  );
}
