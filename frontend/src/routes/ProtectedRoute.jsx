import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { canAccessNavigation } from "../utils/navigationAccess.js";

// path: the page whose access rule (utils/navigationAccess.js) opens this route. Without it, any
// signed-in person passes and the page's API decides what they read.
export default function ProtectedRoute({ path, requiresTeam = false }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) return <div className="page-loader">{t("Loading session...")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requiresTeam && user.hasTeam !== true) return <Navigate to="/" replace />;
  // Both are finished on the sign-in page: a new password, then (administrators, when required)
  // the authenticator app.
  if (user.passwordResetRequired || user.twoFactorSetupRequired) return <Navigate to="/login" replace />;
  if (path && !canAccessNavigation(user, path)) return <Navigate to="/" replace />;

  return <Outlet />;
}
