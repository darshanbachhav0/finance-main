import { useState } from "react";
import { Mail } from "lucide-react";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";

// Account-menu switch: also receive new bell notifications by email - once a day as one summary
// (the default) or right away.
export default function EmailNotificationsControl() {
  const { user, updateUserFields } = useAuth();
  const { t } = useLanguage();
  const { notify } = useToast();
  const [saving, setSaving] = useState(false);
  const hasEmail = Boolean(user.email);
  const enabled = hasEmail && user.emailNotifications !== false;
  const frequency = user.emailFrequency === "IMMEDIATE" ? "IMMEDIATE" : "DAILY";

  async function save(changes, message) {
    setSaving(true);
    try {
      await api.put("/users/me/notification-preferences", changes);
      updateUserFields(changes);
      notify(message, "success");
    } catch {
      notify("Could not update email notifications. Try again.", "error");
    } finally {
      setSaving(false);
    }
  }

  function change(event) {
    const emailNotifications = event.target.checked;
    void save({ emailNotifications }, emailNotifications ? "New notifications will also be emailed to you." : "Notification emails turned off.");
  }

  return <>
    <label className="theme-control email-notifications-control" title={hasEmail ? user.email : t("No email address on file. Ask an administrator to add it.")}>
      <Mail size={17} aria-hidden="true" />
      <span>{t("Email notifications")}{!hasEmail && <small>{t("No email address on file")}</small>}</span>
      <input type="checkbox" checked={enabled} disabled={saving || !hasEmail} onChange={change} aria-label={t("Email notifications")} />
    </label>
    {enabled && <label className="theme-control email-frequency-control">
      <span>{t("When")}</span>
      <select value={frequency} disabled={saving} aria-label={t("When to email me")} onChange={(event) => save({ emailFrequency: event.target.value }, event.target.value === "DAILY" ? "You will get one summary email a day." : "You will get an email for each notification.")}>
        <option value="DAILY">{t("One summary a day")}</option>
        <option value="IMMEDIATE">{t("Right away")}</option>
      </select>
    </label>}
  </>;
}
