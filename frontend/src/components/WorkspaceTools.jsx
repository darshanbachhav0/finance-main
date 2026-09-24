import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { canAccessNavigation } from "../utils/navigationAccess.js";
export default function WorkspaceTools({ links }) {
  const { user } = useAuth(); const { t } = useLanguage();
  const visible = links.filter(([, path]) => canAccessNavigation(user.role, path, user));
  return visible.length ? <details className="workspace-tools"><summary>{t("Related tools")}</summary><div className="focus-tabs">{visible.map(([label, path]) => <Link key={path} to={path}>{t(label)}</Link>)}</div></details> : null;
}
