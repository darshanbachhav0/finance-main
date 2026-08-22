import { LockKeyhole, LogIn, ShieldCheck, UsersRound } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle.jsx";
import Message from "../components/Message.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const demos = [
  { key: "admin", role: "Admin", email: "demo.admin@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "solicitor", role: "Solicitor", email: "demo.solicitante.salud@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "director", role: "Area Director", email: "demo.director.salud@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "vice", role: "Vice Rector", email: "demo.vicerrector@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "accounting", role: "Accounting", email: "demo.contabilidad@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "treasury", role: "Treasury", email: "demo.tesoreria@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "budget", role: "Budget", email: "demo.presupuesto@uma.edu.pe", password: "UMA-Demo-2026!" },
  { key: "management", role: "Management", email: "demo.gerencia@uma.edu.pe", password: "UMA-Demo-2026!" }
];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const [selectedDemo, setSelectedDemo] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
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
      setEmail(account.email);
      setPassword(account.password);
      return;
    }
    setEmail("");
    setPassword("");
  }

  const selectedAccount = demos.find((demo) => demo.key === selectedDemo);

  return (
    <main className="login-screen">
      <div className="login-language"><LanguageToggle /></div>
      <section className="login-shell">
        <div className="login-brand-panel">
          <div className="login-brand"><span>FC</span><div><strong>{t("Financial Control")}</strong><small>{t("ERP operations")}</small></div></div>
          <div className="login-system-mark"><ShieldCheck size={30} /><strong>{t("Financial Request & Payment Control")}</strong><span>{t("Authorized business users only")}</span></div>
          <small className="login-version">ERP Financial Control · v1.0</small>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-form-heading"><LockKeyhole size={24} /><div><h1>{t("Sign in")}</h1><p>{t("Use your assigned company account.")}</p></div></div>
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
                : t("Selecting a role fills the corresponding UMA demo email and password.")}
            </p>
          </fieldset>
          <div className="login-divider"><span>{t("Or sign in with an assigned account")}</span></div>
          <Message type="error">{error}</Message>
          <label className="field"><span>{t("Email")}</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
          <label className="field"><span>{t("Password")}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary-button login-submit" type="submit" disabled={loading}><LogIn size={17} /><span>{t(loading ? "Signing in..." : "Sign in")}</span></button>
        </form>
      </section>
    </main>
  );
}
