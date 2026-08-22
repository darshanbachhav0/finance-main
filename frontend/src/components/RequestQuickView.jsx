import { ArrowRight, Calendar, CircleDollarSign, Pencil } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import ApprovalTimeline from "./ApprovalTimeline.jsx";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import StatusBadge from "./StatusBadge.jsx";

export default function RequestQuickView({ requestId, onClose }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) return;
    setRequest(null);
    setError("");
    api.get(`/requests/${requestId}`).then((response) => setRequest(response.data.data)).catch((err) => setError(err.message));
  }, [requestId]);

  const editable = request && ["BORRADOR", "RECHAZADO", "OBSERVADO", "OBSERVADO_PRESUPUESTO", "OBSERVADO_SUNAT", "OBSERVADO_MONTO_EXCEDIDO", "OBSERVADO_CARGA_MASIVA", "DEVUELTO"].includes(request.status) && (user.role === "Admin" || (request.requester?._id || request.solicitor?._id) === user._id);

  return (
    <Drawer
      open={Boolean(requestId)}
      title={request?.requestNumber || "Request quick view"}
      description={request ? `${request.flowType || "A1"} · ${request.requestType}` : "Loading request..."}
      size="large"
      onClose={onClose}
      footer={request && (
        <>
          {editable && <Link className="secondary-button" to={`/requests/${request._id}/edit`}><Pencil size={16} /><span>{t("Edit request")}</span></Link>}
          <Link className="primary-button" to={`/requests/${request._id}`}><span>{t("Open full details")}</span><ArrowRight size={16} /></Link>
        </>
      )}
    >
      <Message type="error">{error}</Message>
      {!request && !error && <div className="quick-view-loading"><span className="skeleton skeleton-value" /><span className="skeleton skeleton-block" /></div>}
      {request && (
        <div className="detail-stack">
          <div className="quick-view-summary">
            <StatusBadge status={request.status} />
            <h3>{request.supplier?.name || request.supplier?.legalName || request.rendition?.beneficiarySnapshot?.name || request.requester?.name || "-"}</h3>
            <span>{request.supplier?.rucDni || request.rendition?.beneficiarySnapshot?.employeeCode || `Track ${request.flowType || "A1"}`}</span>
            <strong>{request.currency} {Number(request.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
          </div>
          <div className="quick-facts">
            <div><span>{t("Track")}</span><strong>{request.flowType || "A1"}</strong></div>
            <div><Calendar size={17} /><span>{t("Period")}</span><strong>{request.accountingPeriod}</strong></div>
            <div><CircleDollarSign size={17} /><span>{t("PEN equivalent")}</span><strong>{Number(request.totalPENEquivalent ?? request.penEquivalent ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong></div>
          </div>
          <div className="detail-section">
            <h3>{t("Description")}</h3>
            <p>{request.description}</p>
          </div>
          <div className="detail-section">
            <div className="section-heading compact"><h3>{t("Accounting lines")}</h3><span>{request.lines?.length || 0}</span></div>
            <div className="compact-lines">
              {request.lines?.map((line) => (
                <div key={line._id}>
                  <span>{line.costCenter?.code} · {line.expenseType?.accountNumber}</span>
                  <strong>{request.currency} {Number(line.totalAmount || 0).toFixed(2)}</strong>
                </div>
              ))}
            </div>
          </div>
          <div className="detail-section">
            <h3>{t("Latest activity")}</h3>
            <ApprovalTimeline history={(request.approvalHistory || []).slice(-3).reverse()} />
          </div>
        </div>
      )}
    </Drawer>
  );
}
