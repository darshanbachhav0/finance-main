import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { formatDateTime } from "../utils/formatters.js";

export default function ContinueWork() {
  const { t, language } = useLanguage();
  const [rows, setRows] = useState([]);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [discarding, setDiscarding] = useState(null);
  async function discard(row) {
    try { await api.delete(`/work-drafts/${row._id}`, { params: { revision: row.revision } }); setDiscarding(null); await load(); }
    catch (err) { setError(err.message); }
  }
  async function load() { try { setRows((await api.get("/work-drafts")).data.data); setError(""); } catch (err) { setError(err.message); } }
  useEffect(() => { void load(); window.addEventListener("uma:drafts-changed", load); return () => window.removeEventListener("uma:drafts-changed", load); }, []);
  if (!rows.length && !error) return null;
  return <section className="workspace-panel continue-work"><h2>{t("Continue your work")}</h2>{error && <p role="alert">{error} <button type="button" onClick={load}>{t("Retry")}</button></p>}
    {(expanded ? rows : rows.slice(0, 3)).map(row => <div className="continue-work-row" key={row._id}><div><strong>{t(row.title)}</strong><small>{formatDateTime(row.updatedAt, language)}</small></div><div className="work-draft-actions"><Link className="secondary-button" to={`${row.route}?${new URLSearchParams({ workDraft: row._id, workScope: row.scope, workRecord: row.recordId })}`}>{t("Continue")}</Link><button type="button" className="text-button" onClick={() => setDiscarding(row)}>{t("Discard draft")}</button></div></div>)}
    {discarding && <div className="work-draft-confirm"><span>{t("Delete this unfinished draft and its attachments?")}</span><button type="button" className="danger-button" onClick={() => discard(discarding)}>{t("Discard draft")}</button><button type="button" className="secondary-button" onClick={() => setDiscarding(null)}>{t("Keep draft")}</button></div>}
    {rows.length > 3 && <button type="button" className="text-button" onClick={() => setExpanded(!expanded)}>{t(expanded ? "Show less" : "Show all drafts")}</button>}
  </section>;
}
