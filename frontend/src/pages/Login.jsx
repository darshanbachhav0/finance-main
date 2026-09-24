import { Eye, EyeOff, LockKeyhole, LogIn, ShieldCheck, UsersRound } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle.jsx";
import Message from "../components/Message.jsx";
import UmaBrand from "../components/UmaBrand.jsx";
import ThemeControl from "../components/ThemeControl.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const DEMO_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";

const demos = DEMO_LOGIN_ENABLED ? [
  { key: "admin", role: "Admin", dni: "10000001", password: "UMA-Demo-2026!" },
  { key: "solicitor", role: "Solicitor", dni: "10000002", password: "UMA-Demo-2026!" },
  { key: "director", role: "Area Director", dni: "10000003", password: "UMA-Demo-2026!" },
  { key: "vice", role: "Vice Rector", dni: "10000004", password: "UMA-Demo-2026!" },
  { key: "accounting", role: "Accounting", dni: "10000005", password: "UMA-Demo-2026!" },
  { key: "treasury", role: "Treasury", dni: "10000006", password: "UMA-Demo-2026!" },
  { key: "budget", role: "Budget", dni: "10000007", password: "UMA-Demo-2026!" },
  { key: "management", role: "Management", dni: "10000008", password: "UMA-Demo-2026!" },
  { key: "procurement", role: "Procurement", dni: "10000013", password: "UMA-Demo-2026!" }
] : [];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const [selectedDemo, setSelectedDemo] = useState("");
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(dni, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function selectDemo(event) {
    const account = demos.find((demo) => demo.key === event.target.value);
    setSelectedDemo(event.target.value);
    setError("");
    if (account) {
      setDni(account.dni);
      setPassword(account.password);
      return;
    }
    setDni("");
    setPassword("");
  }

  const selectedAccount = demos.find((demo) => demo.key === selectedDemo);

  return (
    <main className="login-screen">
      <div className="login-language"><ThemeControl /><LanguageToggle /></div>
      <section className="login-shell">
        <div className="login-brand-panel">
          <UmaBrand />
          <div className="login-system-mark"><ShieldCheck size={30} /><strong>{t("One place for your financial work.")}</strong><p>{t("Requests, approvals and budgets. Connected from the first step to payment.")}</p><span>{t("Universidad María Auxiliadora")}</span></div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-form-heading"><LockKeyhole size={24} /><div><h1>{t("Welcome to UMA")}</h1><p>{t("Sign in with your university account.")}</p></div></div>
          {DEMO_LOGIN_ENABLED && (
            <>
              <fieldset className="login-role-access" disabled={loading}>
                <legend><UsersRound size={16} />{t("Demo role access")}</legend>
                <label className="field">
                  <span>{t("Choose demo role")}</span>
                  <select value={selectedDemo} onChange={selectDemo} autoFocus>
                    <option value="">{t("Select a role...")}</option>
                    {demos.map((demo) => <option key={demo.key} value={demo.key}>{t(demo.role)}</option>)}
                  </select>
                </label>
                <p className={selectedAccount ? "login-role-help is-ready" : "login-role-help"} role="status">
                  {selectedAccount
                    ? t("Demo credentials ready for {role}.").replace("{role}", t(selectedAccount.role))
                    : t("Selecting a role fills the corresponding UMA demo DNI and password.")}
                </p>
              </fieldset>
              <div className="login-divider"><span>{t("Or sign in with an assigned account")}</span></div>
            </>
          )}
          <Message type="error">{error}</Message>
          <label className="field"><span>{t("DNI")}</span><input type="text" inputMode="numeric" pattern="[0-9]{6,8}" autoComplete="username" value={dni} onChange={(event) => setDni(event.target.value)} required autoFocus={!DEMO_LOGIN_ENABLED} /></label>
          <label className="field"><span>{t("Password")}</span><div className="password-control"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="icon-button quiet" aria-label={t(showPassword ? "Hide password" : "Show password")} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>
          <button className="primary-button login-submit" type="submit" disabled={loading}><LogIn size={17} /><span>{t(loading ? "Signing in..." : "Sign in")}</span></button>
        </form>
      </section>
    </main>
  );
}
