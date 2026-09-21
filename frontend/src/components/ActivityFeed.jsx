import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDateTime } from "../utils/formatters.js";

export default function ActivityFeed() {
  const { t, language } = useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!open) return;
    let active = true;
    const controller = new AbortController();
    async function load() { if (document.hidden) return; setLoading(true); try { const response = await api.get("/notifications", { params: { limit: 10 }, signal: controller.signal }); if (active) { setItems(response.data.data || []); setError(""); } } catch (err) { if (active) setError(err.message); } finally { if (active) setLoading(false); } }
    load(); const timer = setInterval(load, 30000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [open]);
  return <details className="workspace-panel activity-feed" onToggle={event => setOpen(event.currentTarget.open)}><summary>{t("Recent activity for you")}</summary><small>{t("Latest notifications · refreshes every 30 seconds while open")}</small>{error && <p role="alert">{error}</p>}{loading && !items.length && <p role="status">{t("Loading...")}</p>}<ol>{items.map(item => <li key={item._id}><Link to={item.path || "/"}>{t(item.title)}</Link><p>{t(item.message)}</p><small>{formatDateTime(item.createdAt, language)}</small></li>)}</ol>{!loading && !items.length && !error && <p>{t("No notifications yet.")}</p>}</details>;
}
