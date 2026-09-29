import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { canAccessNavigation } from "../utils/navigationAccess.js";

// Shortcuts to related workspaces, shown as a row of compact chips under the page header
// (they used to be hidden behind a "Related tools" disclosure). The row wraps on small screens.
export default function WorkspaceTools({ links }) {
  const { user } = useAuth(); const { t } = useLanguage();
  const visible = links.filter(([, path]) => canAccessNavigation(user.role, path, user));
  if (!visible.length) return null;
  return <nav className="workspace-shortcuts" aria-label={t("Related tools")}>
    <span className="workspace-shortcuts-label" aria-hidden="true">{t("Related tools")}</span>
    <ul>{visible.map(([label, path]) => <li key={path}><Link className="shortcut-chip" to={path}><span>{t(label)}</span><ArrowUpRight size={14} aria-hidden="true" /></Link></li>)}</ul>
  </nav>;
}
