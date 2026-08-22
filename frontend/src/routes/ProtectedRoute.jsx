import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

export default function ProtectedRoute({ roles }) {
  const { user, loading } = useAuth();
  const { t } = useLanguage();

  if (loading) return <div className="page-loader">{t("Loading session...")}</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (roles?.length && !roles.includes(user.role)) return <Navigate to="/" replace />;

  return <Outlet />;
}
