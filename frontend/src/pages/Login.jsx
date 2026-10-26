import { Eye, EyeOff, KeyRound, LockKeyhole, LogIn, ShieldCheck, Smartphone, UsersRound } from "lucide-react";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import api from "../api/client.js";
import LanguageToggle from "../components/LanguageToggle.jsx";
import Message from "../components/Message.jsx";
import UmaBrand from "../components/UmaBrand.jsx";
import ThemeControl from "../components/ThemeControl.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import "../styles/superAdmin.css";

const DEMO_LOGIN_ENABLED = import.meta.env.VITE_ENABLE_DEMO_LOGIN === "true";

const demos = DEMO_LOGIN_ENABLED ? [
  { key: "admin", role: "Admin", dni: "10000001", password: "UMA-Demo-2026!" },
  { key: "accounting", role: "Accounting", dni: "10000005", password: "UMA-Demo-2026!" },
  { key: "treasury", role: "Treasury", dni: "10000006", password: "UMA-Demo-2026!" }
] : [];

// The authenticator setup key, in groups of four so it is easy to type into the app.
function groupedKey(secret) {
  return String(secret || "").match(/.{1,4}/g)?.join(" ") || "";
}

export default function Login() {
  const { login, changePassword, verifyTwoFactor, cancelTwoFactor, setupTwoFactor, enableTwoFactor, twoFactorPending, logout, user, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const [selectedDemo, setSelectedDemo] = useState("");
  const [dni, setDni] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState("");
  const [enrolment, setEnrolment] = useState(null);
  const [platform, setPlatform] = useState(null);

  const [newPassword, setNewPassword] = useState("");
  const resetRequired = isAuthenticated && user?.passwordResetRequired;
  const setupRequired = isAuthenticated && !resetRequired && user?.twoFactorSetupRequired;

  // Maintenance notice and announcement, before signing in.
  useEffect(() => {
    let active = true;
    api.get("/auth/platform-status").then((response) => active && setPlatform(response.data.data)).catch(() => {});
    return () => { active = false; };
  }, []);

  // First sign-in of a Super Admin: a new authenticator key to add to the app.
  useEffect(() => {
    if (!setupRequired || enrolment) return;
    setupTwoFactor().then(setEnrolment).catch((err) => setError(err.message));
  }, [setupRequired]);

  if (isAuthenticated && !resetRequired && !setupRequired) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      if (resetRequired) await changePassword(password, newPassword);
      else if (setupRequired) await enableTwoFactor(code);
      else if (twoFactorPending) await verifyTwoFactor(code);
      else {
        const result = await login(dni, password);
        if (result?.twoFactorRequired) setCode("");
      }
    } catch (err) {
      // The sign-in step expired: start again from the DNI and password.
      if (twoFactorPending && err.code === "TWO_FACTOR_INVALID" && err.status === 401 && /expired/i.test(err.message || "")) cancelTwoFactor();
      setError([err.message, err.details?.message].filter(Boolean).join("\n"));
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

  function startOver() {
    cancelTwoFactor();
    setCode("");
    setPassword("");
    setError("");
  }

  const selectedAccount = demos.find((demo) => demo.key === selectedDemo);
  const codeStep = setupRequired || (twoFactorPending && !isAuthenticated);
  const credentialsStep = !resetRequired && !codeStep;
  const minLength = platform?.passwordMinLength || 10;
  const heading = setupRequired ? "Set up your authenticator app" : codeStep ? "Enter your authenticator code" : "Welcome to UMA";
  const subheading = setupRequired ? "Your account signs in with a code from an authenticator app." : codeStep ? "Open your authenticator app and enter the 6-digit code for UMA Finanzas." : "Sign in with your university account.";
  const buttonLabel = loading ? (resetRequired || setupRequired ? "Saving..." : "Signing in...") : resetRequired ? "Change password" : setupRequired ? "Turn on authenticator sign-in" : codeStep ? "Verify code" : "Sign in";

  return (
    <main className="login-screen">
      <div className="login-language"><ThemeControl /><LanguageToggle /></div>
      <section className="login-shell">
        <div className="login-brand-panel">
          <UmaBrand />
          <div className="login-system-mark"><ShieldCheck size={30} /><strong>{t("One place for your financial work.")}</strong><p>{t("Requests, approvals and budgets. Connected from the first step to payment.")}</p><span>{t("Universidad María Auxiliadora")}</span></div>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-form-heading">{codeStep ? <Smartphone size={24} /> : <LockKeyhole size={24} />}<div><h1>{t(heading)}</h1><p>{t(subheading)}</p></div></div>
          {platform?.maintenance?.enabled && <Message type="warning">{[t("The platform is in maintenance. Only administrators can sign in right now."), platform.maintenance.message].filter(Boolean).join(" ")}</Message>}
          {platform?.announcement?.enabled && <Message type={platform.announcement.tone === "warning" ? "warning" : "info"}>{platform.announcement.message}</Message>}
          {DEMO_LOGIN_ENABLED && credentialsStep && (
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
          {credentialsStep && <label className="field"><span>{t("DNI")}</span><input type="text" inputMode="numeric" pattern="[0-9]{6,8}" autoComplete="username" value={dni} onChange={(event) => setDni(event.target.value)} required autoFocus={!DEMO_LOGIN_ENABLED} /></label>}
          {!codeStep && <label className="field"><span>{t(resetRequired ? "Current password" : "Password")}</span><div className="password-control"><input type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /><button type="button" className="icon-button quiet" aria-label={t(showPassword ? "Hide password" : "Show password")} aria-pressed={showPassword} onClick={() => setShowPassword((value) => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}
          {resetRequired && <><Message>{t(user?.passwordExpired ? "Your password expired. Choose a new one to continue." : "Change your initial password to continue.")}</Message><label className="field"><span>{t("New password")}</span><input type="password" autoComplete="new-password" minLength={minLength} maxLength={72} value={newPassword} onChange={event => setNewPassword(event.target.value)} required /><small className="field-hint">{t("At least {count} characters.").replace("{count}", minLength)}</small></label></>}
          {setupRequired && (
            <ol className="two-factor-steps">
              <li>{t("Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar).")}</li>
              <li>
                <span>{t("Add an account with this setup key (time-based):")}</span>
                {enrolment ? <code className="two-factor-key" aria-label={t("Setup key")}>{groupedKey(enrolment.secret)}</code> : <span role="status">{t("Loading...")}</span>}
                {enrolment && <a className="text-button" href={enrolment.otpauthUri}><KeyRound size={15} aria-hidden="true" />{t("Open in my authenticator app")}</a>}
              </li>
              <li>{t("Enter the 6-digit code the app shows.")}</li>
            </ol>
          )}
          {codeStep && <label className="field"><span>{t("Authenticator code")}</span><input type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} required autoFocus /></label>}
          <button className="primary-button login-submit" type="submit" disabled={loading || (setupRequired && !enrolment)}><LogIn size={17} /><span>{t(buttonLabel)}</span></button>
          {codeStep && !setupRequired && <button type="button" className="text-button" onClick={startOver} disabled={loading}>{t("Use a different account")}</button>}
          {(resetRequired || setupRequired) && <button type="button" className="text-button" onClick={() => { void logout(); }} disabled={loading}>{t("Sign out")}</button>}
        </form>
      </section>
    </main>
  );
}
