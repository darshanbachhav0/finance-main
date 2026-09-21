import { useState } from "react";
import { useLanguage } from "../context/LanguageContext.jsx";
import useMediaQuery from "../hooks/useMediaQuery.js";
import Drawer from "./Drawer.jsx";
import { ApprovalJourney } from "./ExperienceIndicators.jsx";

export function ResponsiveActionPanel({ children }) {
  const { t } = useLanguage();
  const mobile = useMediaQuery("(max-width: 700px)");
  return mobile ? <details className="workspace-panel action-panel mobile-action-panel"><summary>{t("Available actions")}</summary><div>{children}</div></details> : <div className="workspace-panel action-panel">{children}</div>;
}

export function RequestContextHelp({ request, documentStatus }) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const phase = documentStatus.currentPhase;
  const requirements = documentStatus.phases?.[phase]?.requirements || [];
  const actions = { APPROVE: "Approve", OBSERVE: "Observe", RETURN: "Return", REJECT: "Reject", EDIT: "Edit request", CANCEL: "Annul request", CLOSE: "Close request", SUBMIT: "Submit", COMMIT_BUDGET: "Commit budget", ISSUE_ORDER: "Issue order" };
  return <><button type="button" className="text-button" onClick={() => setOpen(true)}>{t("Help with this request")}</button><Drawer open={open} onClose={() => setOpen(false)} title="Help with this request"><h3>{request.requestNumber}</h3><p>{t("Current document phase")}: {t(phase)}</p><ul>{requirements.map(item => <li key={item.kind}>{t(item.labelKey || item.kind)} · {item.present}/{item.minCount} · {t(item.present >= item.minCount ? "Complete" : "Missing")}</li>)}</ul>{!requirements.length && <p>{t("No documents required in this phase.")}</p>}<ApprovalJourney request={request} /><h3>{t("Available actions")}</h3><ul>{(request.allowedActions || []).map(action => <li key={action}>{t(actions[action] || action)}</li>)}</ul>{!request.allowedActions?.length && <p>{t("No action available")}</p>}<p>{t("Actions are checked again by the server when you submit them.")}</p></Drawer></>;
}
