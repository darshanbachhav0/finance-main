import { useState } from "react";
import { Mail, Send } from "lucide-react";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

// Account-menu switch: also receive new bell notifications by email. Administrators also get a
// "Send test email" action to check the server's email setup without a shell.
export default function EmailNotificationsControl() {
  const { user, updateUserFields } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState("");
  const hasEmail = Boolean(user.email);
  const enabled = hasEmail && user.emailNotifications !== false;

  async function change(event) {
    const emailNotifications = event.target.checked;
    setSaving(true);
    try {
      await api.put("/users/me/notification-preferences", { emailNotifications });
      updateUserFields({ emailNotifications });
      notify(emailNotifications ? "New notifications will also be emailed to you." : "Notification emails turned off.", "success");
    } catch {
      notify("Could not update email notifications. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    setTestError("");
    try {
      await api.post("/notifications/test-email", {});
      notify("Test email sent to your address. Check your inbox and the spam folder.", "success", { duration: 10000 });
    } catch (err) {
      setTestError(err.message);
    } finally {
      setTesting(false);
    }
  }

  return <>
    <label className="theme-control email-notifications-control" title={hasEmail ? user.email : t("No email address on file. Ask an administrator to add it.")}>
      <Mail size={17} aria-hidden="true" />
      <span>{t("Email notifications")}{!hasEmail && <small>{t("No email address on file")}</small>}</span>
      <input type="checkbox" checked={enabled} disabled={saving || !hasEmail} onChange={change} aria-label={t("Email notifications")} />
    </label>
    {user.role === "Admin" && hasEmail && <div className="email-test-action">
      <button type="button" className="text-button" onClick={sendTest} disabled={testing}><Send size={14} aria-hidden="true" />{t(testing ? "Sending test email..." : "Send test email")}</button>
      {testError && <small className="email-test-error" role="alert">{testError}</small>}
    </div>}
  </>;
}
