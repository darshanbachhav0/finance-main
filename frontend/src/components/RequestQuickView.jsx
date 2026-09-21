import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import RequestStageIndicator from "./RequestStageIndicator.jsx";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import FinancialProgressSummary from "./FinancialProgressSummary.jsx";

function InlinePreview({ title, children }) { return <div className="inline-request-preview"><h3>{title}</h3>{children}</div>; }
export default function RequestQuickView({ requestId, onClose, inline = false }) {
  const { t } = useLanguage();
  const [request, setRequest] = useState(null);
  const [financialProgress, setFinancialProgress] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!requestId) return;
    setRequest(null);
    setFinancialProgress(null);
    setError("");
    let active = true;
    api.get(`/requests/${requestId}`).then((response) => {
      if (!active) return;
      setRequest(response.data.data);
      setFinancialProgress(response.data.related?.financialProgress || null);
    }).catch((err) => active && setError(err.message));
    return () => { active = false; };
  }, [requestId]);

  const Container = inline ? InlinePreview : Drawer;
  return (
    <Container
      open={Boolean(requestId)}
      title={request?.requestNumber || "Request quick view"}
      description={request ? `${request.flowType || "A1"} · ${request.requestType}` : "Loading request..."}
      size="small"
      onClose={onClose}
      footer={request && (
        <>
          <Link className="primary-button" to={`/requests/${request._id}`}><span>{t("Open full details")}</span><ArrowRight size={16} /></Link>
        </>
      )}
    >
      <Message type="error">{error}</Message>
      {!request && !error && <div className="quick-view-loading"><span className="skeleton skeleton-value" /><span className="skeleton skeleton-block" /></div>}
      {request && (
        <div className="detail-stack">
          <div className="quick-view-summary">
            <h3>{request.title || request.description}</h3>
            <span>{t("Requester")}: {request.requester?.name || request.solicitor?.name || "—"}</span>
            <strong>{request.currency} {Number(request.totalAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</strong>
            <FinancialProgressSummary request={request} financialProgress={financialProgress} compact />
            <RequestStageIndicator request={request} financialProgress={financialProgress} />
          </div>
        </div>
      )}
    {inline && request && <Link className="primary-button" to={`/requests/${request._id}`}>{t("Open full details")}</Link>}
    </Container>
  );
}
