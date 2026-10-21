import { Link, useSearchParams } from "react-router-dom";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import DataTable from "../components/DataTable.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Message from "../components/Message.jsx";
import Drawer from "../components/Drawer.jsx";
import { formatCurrency, formatDate } from "../utils/formatters.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { scheduledPaymentDate, supplierCreditDays } from "../../../shared/invoiceFinance.mjs";

export default function DepartmentInvoices() {
  const { t, language } = useLanguage();
  const [params, setParams] = useSearchParams();
  const [payload, setPayload] = useState({ data: [] });
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const state = params.get("state") || "all";
  const page = Math.max(1, Number(params.get("page")) || 1);
  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api.get("/dashboard/invoices", { params: { state, page, pageSize: 20 } }).then(response => active && setPayload(response.data))
      .catch(err => active && setError(err.message)).finally(() => active && setLoading(false));
    return () => { active = false; };
  }, [state, page]);
  const voucher = row => [row.voucher?.series, row.voucher?.number].filter(Boolean).join("-") || "—";
  return <section>
    <PageHeader title="Department invoices" actions={<Link className="text-link" to="/">Volver al inicio</Link>} />
    <Message type="error">{error}</Message>
    <div className="workspace-panel">
      <label className="field field-narrow"><span>Estado de factura</span><select aria-label="Invoice status" value={state} onChange={event => setParams({ state: event.target.value })}>
        <option value="all">Todas</option><option value="due">Por vencer y vencidas</option>{["Pendiente", "Por vencer", "Vencida", "Pagada"].map(value => <option key={value}>{value}</option>)}
      </select></label>
      <DataTable controls={false} loading={loading} rows={payload.data} onRowClick={setSelected} columns={[
        { key: "voucher", label: "Invoice number", render: row => <button type="button" className="text-button" onClick={() => setSelected(row)}>{voucher(row)}</button> },
        { key: "supplier", label: "Supplier", render: row => row.supplier?.legalName || row.supplier?.name || "—" },
        { key: "originalAmount", label: "Amount", align: "right", render: row => formatCurrency(row.originalAmount, row.currency, language) },
        { key: "dueDate", primary: true, label: "Due date", render: row => formatDate(row.dueDate, language) },
        { key: "outstandingAmount", label: "Outstanding amount", align: "right", render: row => formatCurrency(row.outstandingAmount, row.currency, language) },
        { key: "invoiceState", primary: true, label: "Status" }
      ]} emptyDescription="No invoices in this state." />
      {payload.pagination?.totalPages > 1 && <div className="inline-form-actions"><button className="secondary-button" disabled={loading || page <= 1} onClick={() => setParams({ state, page: String(page - 1) })}>Anterior</button><span>{page} / {payload.pagination.totalPages}</span><button className="secondary-button" disabled={loading || page >= payload.pagination.totalPages} onClick={() => setParams({ state, page: String(page + 1) })}>Siguiente</button></div>}
    </div>
    <Drawer open={Boolean(selected)} title={selected ? `Factura ${voucher(selected)}` : "Factura"} onClose={() => setSelected(null)}>
      {selected && <dl className="detail-grid">{[
        ["Supplier", selected.supplier?.legalName || selected.supplier?.name],
        ["Amount", formatCurrency(selected.originalAmount, selected.currency, language)],
        ["Credit days", selected.paymentTermsSnapshot?.creditDays ?? supplierCreditDays(selected.paymentTermsSnapshot) ?? "Sin especificar"],
        ["Invoice issue date", formatDate(selected.voucher?.documentDate, language)],
        ["Due date", formatDate(selected.dueDate, language)],
        ["Outstanding amount", formatCurrency(selected.outstandingAmount, selected.currency, language)],
        ["Status", selected.invoiceState],
        ["Scheduled payment date", scheduledPaymentDate(selected) ? formatDate(scheduledPaymentDate(selected), language) : "Por programar"],
        ["Actual payment date", formatDate(selected.paidDate, language)]
      ].map(([label, value]) => <div key={label}><dt>{t(label)}</dt><dd>{value ?? "—"}</dd></div>)}
        <div><dt>Solicitud</dt><dd><Link to={`/requests/${selected.request?._id}`}>{selected.request?.requestNumber}</Link></dd></div>
      </dl>}
    </Drawer>
  </section>;
}
