import { useEffect, useState } from "react";
import { HelpCircle, Accessibility } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { roleNavigation } from "../utils/navigationAccess.js";
import Drawer from "./Drawer.jsx";

export default function ExperienceTools() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const key = `uma:experience:${user._id}`;
  const [preferences, setPreferences] = useState(() => { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } });
  const [panel, setPanel] = useState("");
  const [tourStep, setTourStep] = useState(0);
  const links = roleNavigation[user.role] || [];
  useEffect(() => { const tour = () => { setTourStep(0); setPanel("tour"); }; window.addEventListener("uma:start-tour", tour); return () => window.removeEventListener("uma:start-tour", tour); }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.reduceMotion = String(Boolean(preferences.reduceMotion));
    root.dataset.highContrast = String(Boolean(preferences.highContrast));
    root.dataset.largeText = String(Boolean(preferences.largeText));
    try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Settings still work for this session. */ }
    window.dispatchEvent(new Event("uma:accessibility"));
    return () => { delete root.dataset.reduceMotion; delete root.dataset.highContrast; delete root.dataset.largeText; };
  }, [preferences, key]);
  const current = links.find(([, path]) => path !== "/" && location.pathname.startsWith(path)) || links[0];
  const guidance = location.pathname.startsWith("/requests") ? "Open a request to see its current stage, required documents and the actions available to you. Payment and rendition progress are shown separately."
    : location.pathname.startsWith("/treasury") ? "Review the payment destination and currency before generating a BBVA file. Confirm payment only after receiving bank evidence."
    : location.pathname.startsWith("/accounting") ? "Review fiscal evidence and the open accounting period before posting. Open a request to resolve missing documents."
    : location.pathname.startsWith("/approvals") ? "Open the supporting documents, review the SLA and record your decision. The next approver follows the stored approval route."
    : location.pathname.startsWith("/budget") ? "Review availability and commitments in the selected period. Paid amounts are shown separately and must not be added to executed amounts."
    : "Select a KPI or chart to explore its records. Use Search to find work available to your role. Saved views and display preferences apply only to your workspace.";
  return <>
    <button className="icon-button" type="button" aria-label={t("Workspace help")} onClick={() => setPanel("help")}><HelpCircle size={19} /></button>
    <button className="icon-button" type="button" aria-label={t("Accessibility settings")} onClick={() => setPanel("accessibility")}><Accessibility size={19} /></button>
    <Drawer open={Boolean(panel)} onClose={() => setPanel("")} title={panel === "accessibility" ? "Accessibility settings" : panel === "tour" ? "Your workspace tour" : "Workspace help"}>
      {panel === "accessibility" ? <div className="experience-settings">{[["reduceMotion", "Reduce motion"], ["highContrast", "High contrast"], ["largeText", "Larger text"]].map(([name, label]) => <label key={name}><input type="checkbox" checked={Boolean(preferences[name])} onChange={event => setPreferences(value => ({ ...value, [name]: event.target.checked }))} />{t(label)}</label>)}<p>{t("Your system motion preference is always respected.")}</p></div>
        : panel === "tour" ? <div className="tour-card"><small>{tourStep + 1} / {links.length}</small><h3>{t(links[tourStep]?.[0])}</h3><p>{t("This workspace shows the information and actions available to your role.")}</p><Link className="primary-button" to={links[tourStep]?.[1] || "/"} onClick={() => setPanel("")}>{t("Open workspace")}</Link><div className="experience-toolbar"><button type="button" disabled={!tourStep} onClick={() => setTourStep(value => value - 1)}>{t("Previous")}</button><button type="button" onClick={() => { if (tourStep < links.length - 1) setTourStep(value => value + 1); else { setPreferences(value => ({ ...value, toured: true })); setPanel(""); } }}>{t(tourStep < links.length - 1 ? "Next" : "Finish tour")}</button></div></div>
        : <div className="detail-stack"><h3>{t(current?.[0] || "Your workspace")}</h3><p>{t(guidance)}</p><details><summary>{t("Keyboard shortcuts")}</summary><p><kbd>Ctrl / ⌘ K</kbd> {t("Search")} · <kbd>Esc</kbd> {t("Close panel")}</p>{["Admin", "Solicitor"].includes(user.role) && <p><kbd>N</kbd> {t("New request")}</p>}</details><button type="button" className="secondary-button" onClick={() => { setTourStep(0); setPanel("tour"); }}>{t(preferences.toured ? "Restart workspace tour" : "Start workspace tour")}</button></div>}
    </Drawer>
  </>;
}

export function WorkspaceWelcome() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const key = `uma:welcome:${user._id}:${user.role}`;
  const [dismissed, setDismissed] = useState(() => { try { return localStorage.getItem(key) === "true"; } catch { return false; } });
  if (dismissed) return null;
  return <div className="workspace-welcome"><div><strong>{t("Your workspace is ready.")}</strong><small>{t("Use the help button for a short tour and keyboard shortcuts.")}</small></div><button className="text-button" type="button" onClick={() => window.dispatchEvent(new Event("uma:start-tour"))}>{t("Start workspace tour")}</button><button className="text-button" type="button" onClick={() => { setDismissed(true); try { localStorage.setItem(key, "true"); } catch { /* Optional preference. */ } }}>{t("Got it")}</button></div>;
}
