import { Link } from "react-router-dom";
import { useState } from "react";
import StatCard from "./StatCard.jsx";
import DataTable from "./DataTable.jsx";
import PriorityBadge from "./PriorityBadge.jsx";
import StatusBadge from "./StatusBadge.jsx";
import RequestDocumentsDrawer from "./RequestDocumentsDrawer.jsx";
import { formatCurrency, formatDate } from "../utils/formatters.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import "../styles/jefeDashboard.css";

export default function JefeDashboard({ data }) {
  const { language } = useLanguage();
  const [documentsId, setDocumentsId] = useState(null);
  const metrics = [["assigned", "Presupuesto aprobado"], ["committed", "Presupuesto comprometido"], ["executed", "Presupuesto ejecutado"], ["available", "Saldo disponible"]];
  const alerts = data.invoiceAlerts || {};
  return <div className="jefe-dashboard">
    <div className="jefe-budget-scope">Presupuesto del departamento · {data.year} · PEN</div>
    <div className="jefe-kpis">{metrics.map(([key, label]) => <StatCard key={key} label={label} value={data.configured ? formatCurrency(data.totals[key], "PEN", language) : "—"} />)}</div>
    <div className="workspace-panel jefe-budget-progress">
      <div><span>Avance presupuestal</span><strong>{data.progress == null ? "Sin configurar" : `${data.progress}%`}</strong></div>
      {data.progress != null && <progress aria-label="Avance presupuestal" max="100" value={Math.max(0, Math.min(100, data.progress))} />}
      {!data.configured && <p className="muted-text">Finanzas debe configurar el presupuesto anual de los centros de costos del departamento.</p>}
      {data.totals?.transitional && (data.totals.transitional.committed > 0 || data.totals.transitional.executed > 0) && <details><summary>Uso transitorio registrado</summary><p>Los compromisos y la ejecución incluyen movimientos informativos de la fase transitoria. El saldo disponible sigue el control presupuestal vigente de UMA.</p></details>}
    </div>
    {(alerts.overdue > 0 || alerts.dueSoon > 0) && <Link className="jefe-invoice-alert" to="/requests/invoices?state=due">
      {alerts.overdue > 0 ? `${alerts.overdue} factura${alerts.overdue === 1 ? " vencida" : "s vencidas"}` : ""}
      {alerts.overdue > 0 && alerts.dueSoon > 0 ? " · " : ""}
      {alerts.dueSoon > 0 ? `${alerts.dueSoon} factura${alerts.dueSoon === 1 ? " próxima" : "s próximas"} a vencer` : ""} <span aria-hidden="true">→</span>
    </Link>}
    <div className="workspace-panel">
      <div className="section-heading"><h3>Solicitudes pendientes de aprobación</h3><Link className="primary-button" to="/approvals">Revisar solicitudes{data.approvalCount > 0 ? ` (${data.approvalCount})` : ""}</Link></div>
      <DataTable className="cards-narrow-only" controls={false} rows={data.approvals || []} columns={[
        { key: "requestNumber", label: "Request number", render: row => <Link to={`/approvals/${row._id}`}>{row.requestNumber}</Link> },
        { key: "requester", label: "Requester", render: row => row.requester?.name || row.solicitor?.name || "—" },
        { key: "totalAmount", label: "Amount", align: "right", render: row => formatCurrency(row.totalAmount, row.currency, language) },
        { key: "priority", primary: true, label: "Priority", render: row => <PriorityBadge priority={row.priority} /> },
        { key: "scheduledPaymentDate", primary: true, label: "Scheduled payment date", render: row => row.scheduledPaymentDate ? formatDate(row.scheduledPaymentDate, language) : "Por programar" },
        { key: "status", label: "Status", render: row => <StatusBadge status={row.status} /> },
        { key: "actions", label: "Actions", render: row => <button type="button" className="text-button" onClick={() => setDocumentsId(row._id)}>Ver documentos</button> }
      ]} emptyDescription="No requests awaiting approval." />
    </div>
    <Link className="text-link" to="/requests/invoices">Ver facturas del departamento</Link>
    <RequestDocumentsDrawer requestId={documentsId} onClose={() => setDocumentsId(null)} />
  </div>;
}
