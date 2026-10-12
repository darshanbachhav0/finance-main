import { useState } from "react";
import { Mail } from "lucide-react";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

// Account-menu switch: also receive new bell notifications by email.
export default function EmailNotificationsControl() {
  const { user, updateUserFields } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
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

  return <label className="theme-control email-notifications-control" title={hasEmail ? user.email : t("No email address on file. Ask an administrator to add it.")}>
    <Mail size={17} aria-hidden="true" />
    <span>{t("Email notifications")}{!hasEmail && <small>{t("No email address on file")}</small>}</span>
    <input type="checkbox" checked={enabled} disabled={saving || !hasEmail} onChange={change} aria-label={t("Email notifications")} />
  </label>;
}
