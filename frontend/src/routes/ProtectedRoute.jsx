import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

// roles: who has the page by role; permissions: grants (Administration > Users) that open it too.
export default function ProtectedRoute({ roles, permissions = [], requiresTeam = false }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) return <div className="page-loader">{t("Loading session...")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (requiresTeam && user.hasTeam !== true) return <Navigate to="/" replace />;
  if (user.passwordResetRequired) return <Navigate to="/login" replace />;
  const granted = permissions.some((permission) => (user.permissions || []).includes(permission));
  if (roles?.length && !roles.includes(user.role) && !granted) return <Navigate to="/" replace />;

  return <Outlet />;
}
