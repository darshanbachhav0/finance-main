import { ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import PageHeader from "../components/PageHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { canAccessNavigation, pageLabel, settingsGroups } from "../utils/navigationAccess.js";
import { navigationIcon } from "../utils/navigationIcons.js";

const descriptions = {
  "/users": "People, roles, permissions and approval chain.",
  "/cost-centers": "Cost centers (CECO) and their hierarchy.",
  "/expense-types": "Accounting accounts used to classify expenses.",
  "/configuration/accounting-mappings": "GL accounts for automatic postings (CXP, bank, IGV, exchange differences).",
  "/configuration/finance-configurations": "Financial limits and thresholds, such as mobility and rendition deadlines.",
  "/exchange-rates": "Daily SUNAT exchange rates used for USD amounts.",
  "/configuration/approval-rules": "Who approves which requests, by amount, area and track.",
  "/configuration/direct-payment-eligibility": "Where Track B (direct payment) is allowed.",
  "/configuration/budget-rules": "Budget control mode and what happens when budget is insufficient.",
  "/configuration/budget-allocations": "Assigned budget by period, cost center and project.",
  "/configuration/bank-formats": "BBVA payment file formats in PEN and USD."
};

// Every settings page the person can open, grouped. Each card opens the page itself.
export default function SettingsHub() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const groups = settingsGroups
    .map(([label, paths]) => ({ label, paths: paths.filter((path) => canAccessNavigation(user.role, path, user)) }))
    .filter((group) => group.paths.length);

  return (
    <section>
      <PageHeader title="Settings" description="Organization, finance, rules and banking settings you can manage." />
      {groups.map((group, index) => (
        <section className="settings-group" key={group.label} aria-labelledby={`settings-group-${index}`}>
          <h2 id={`settings-group-${index}`}>{t(group.label)}</h2>
          <ul className="settings-grid">
            {group.paths.map((path) => {
              const Icon = navigationIcon(path);
              return (
                <li key={path}>
                  <Link className="workspace-panel settings-card" to={path}>
                    <span className="settings-card-icon" aria-hidden="true"><Icon size={18} /></span>
                    <span className="settings-card-text">
                      <strong>{t(pageLabel(path, user.role))}</strong>
                      <small>{t(descriptions[path])}</small>
                    </span>
                    <ArrowRight className="settings-card-arrow" size={16} aria-hidden="true" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </section>
  );
}
