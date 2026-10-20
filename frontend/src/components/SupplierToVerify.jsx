import { AlertTriangle, Building2 } from "lucide-react";
import { Link } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext.jsx";

// A request's supplier that still waits for its proposer's jefe (supplierApproval from
// GET /approvals/:id/options). That jefe approves it with the request; anyone else deciding the
// request waits for them before finalizing.
export default function SupplierToVerify({ approval }) {
  const { t } = useLanguage();
  if (!approval) return null;
  const { supplier, yours, ready, issues = [], approver } = approval;
  const title = !yours ? "The supplier is still waiting for approval" : ready ? "New supplier: approving this request also approves it" : "The new supplier cannot be approved yet";
  return (
    <div className={`inline-alert ${yours && ready ? "alert-info" : "alert-warning"} supplier-to-verify`} role="note">
      <Building2 size={18} aria-hidden="true" />
      <div>
        <strong>{t(title)}</strong>
        <span>{supplier.name} · RUC {supplier.rucDni} · <Link to={`/suppliers/${supplier._id}`}>{t("Review the supplier")}</Link></span>
        {yours && ready && <span>{t("Check its details and documents. It gets its supplier code (PRV) when you approve.")}</span>}
        {yours && !ready && <>
          <span>{t("Send the request back so the requester completes it:")}</span>
          <ul className="readiness-issues">{issues.map((issue) => <li key={`${issue.code}-${issue.field}`}><AlertTriangle size={15} aria-hidden="true" /><div><strong>{t(issue.code)}</strong><span>{t(issue.message)}</span></div></li>)}</ul>
        </>}
        {!yours && <span>{approver ? t("{name} approves it. The request can be finalized once the supplier is approved.").replace("{name}", approver.name) : t("An Admin approves it. The request can be finalized once the supplier is approved.")}</span>}
      </div>
    </div>
  );
}
