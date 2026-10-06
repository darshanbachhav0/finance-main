import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import api from "../api/client.js";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import PageHeader from "../components/PageHeader.jsx";
import Tabs from "../components/Tabs.jsx";
import MonthInput from "../components/MonthInput.jsx";
import ConfirmDialog from "../components/ConfirmDialog.jsx";
export default function Operations() {
  const loadingSequence = useRef(0);
  const [params] = useSearchParams();
  const [confirmation, setConfirmation] = useState(null);
  const { user } = useAuth(), { t } = useLanguage();
  const [tab, setTab] = useState(params.get("source") ? "Recurring drafts" : "Reviews"), [data, setData] = useState(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [page, setPage] = useState(1);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7)), [source, setSource] = useState(params.get("source") || ""), [statement, setStatement] = useState(null);
  const accounting = ["Admin", "Accounting"].includes(user.role), treasury = ["Admin", "Treasury"].includes(user.role), requester = ["Admin", "Solicitor"].includes(user.role);
  const tabs = ["Reviews", ...(["Admin", "Accounting", "Solicitor", "Procurement", "Treasury"].includes(user.role) ? ["Suppliers"] : []), ...(accounting ? ["Closure", "Month end"] : []), ...(treasury ? ["Statement matching"] : []), ...(requester ? ["Recurring drafts"] : []), ...(user.role === "Admin" ? ["Configuration health"] : [])];
  async function load() {
    const sequence = ++loadingSequence.current;
    setBusy(true); setError(""); setData(null);
    try {
      const endpoint = { Reviews: `/queue?page=${page}`, Closure: `/queue?kind=closure&page=${page}`, Suppliers: "/suppliers", "Configuration health": "/health", "Month end": `/month-end?period=${period}`, "Recurring drafts": "/templates" }[tab];
      if (endpoint) { const response = await api.get(`/operations${endpoint}`); if (sequence === loadingSequence.current) setData(response.data); }
    } catch (error) { if (sequence === loadingSequence.current) setError(error.message); } finally { if (sequence === loadingSequence.current) setBusy(false); }
  }
  useEffect(() => { load(); return () => { loadingSequence.current++; }; }, [tab, page, period]);
  async function act(action) { setBusy(true); setError(""); try { await action(); await load(); } catch (error) { setError(error.message); } finally { setBusy(false); } }
  const issue = (row, index) => <p key={index}>{t(row.message)} <small>· {t(row.owner)}</small>{row.path && <Link to={row.path}> · {t("View")}</Link>}</p>;
  return <section><PageHeader title="Work review" description="Readiness, exceptions and preparation. Financial actions retain their existing controls." />
    <Tabs idPrefix="operations" label="Sections" value={tab} onChange={(name) => { setData(null); setTab(name); setPage(1); }} tabs={tabs.map((name) => ({ id: name, label: name }))} />
    {error && <p role="alert" className="workspace-panel">{error}</p>}{busy && <p role="status">{t("Loading...")}</p>}
    {["Reviews", "Closure"].includes(tab) && <>{data?.data?.map(row => <article className="workspace-panel section-spacer" key={row.id}><Link to={`/requests/${row.id}`}><strong>{row.requestNumber} · {row.title}</strong></Link><p>{t(row.next.message)} · {t(row.next.owner)}</p><small>{t("Updated")}: {new Date(row.updatedAt).toLocaleDateString()}</small>{row.issues.map(issue)}</article>)}<div className="wizard-actions"><button disabled={busy || page === 1} onClick={() => setPage(page - 1)}>{t("Previous")}</button><span>{page} · {data?.total || 0} {t("Requests")}</span><button disabled={busy || page * 20 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>{t("Next")}</button></div></>}
    {tab === "Suppliers" && <><p>{t("Oldest pending suppliers")}: {data?.data?.length || 0} / {data?.total || 0}</p>{data?.data?.map(row => <article key={row.id} className="workspace-panel section-spacer"><strong>{row.name}</strong><p>{row.ready ? t("Ready for Finance review") : t("Requirements pending")}</p>{row.issues?.map((item, i) => issue({ ...item, owner: row.owner, path: row.path }, i))}<Link to={row.path}>{t("View")}</Link></article>)}</>}
    {tab === "Configuration health" && <div className="workspace-panel">{data?.data?.issues?.map(issue)}<p>{t(data?.data?.scope || "")}</p></div>}
    {tab === "Month end" && <div className="workspace-panel"><label>{t("Period")} <MonthInput value={period} onChange={e => setPeriod(e.target.value)} /></label><p>{data?.data?.ready ? t("Ready for closure review") : t("Requirements pending")}</p>{Object.entries(data?.data?.counts || {}).map(([key, count]) => <p key={key}>{t(key)}: {count}</p>)}{data?.data?.items?.map(issue)}<Link to="/accounting/periods">{t("Accounting Periods")}</Link></div>}
    {tab === "Recurring drafts" && <div className="workspace-panel"><p>{t("Create a monthly draft from your OPEX A1 or B request. New documents and approval are required each time.")}</p><p>{source ? <Link to={`/requests/${source}`}>{t("Open source request")}</Link> : t("Open one of your requests and select Prepare recurring drafts.")}</p><label>{t("First month")}<MonthInput value={period} onChange={e => setPeriod(e.target.value)} /></label><button disabled={busy || !source} className="primary-button" onClick={() => act(() => api.post("/operations/templates", { source, nextMonth: period }))}>{t("Create template")}</button>{data?.data?.map(row => <p key={row._id}>{row.name} · {row.nextMonth} · {row.active ? <button disabled={busy} onClick={() => act(() => api.post(`/operations/templates/${row._id}/pause`))}>{t("Pause")}</button> : t("Paused")}</p>)}</div>}
    {tab === "Statement matching" && <div className="workspace-panel"><p>{t("Upload CSV columns: date,reference,currency,amount. Dates: YYYY-MM-DD. Amounts: positive debits. Maximum 100 rows.")}</p><input type="file" accept=".csv" disabled={busy} onChange={e => { const file = e.target.files[0]; if (file) act(async () => { if (file.size > 1024 * 1024) throw Error("Maximum file size is 1 MB."); setStatement((await api.post("/operations/statements", { csv: await file.text() })).data.data); }); }} />{statement?.rows?.map((row, index) => <article key={index} className="workspace-panel section-spacer"><strong>{row.date} · {row.reference} · {row.currency} {row.amount.toFixed(2)}</strong><p>{row.candidates.length === 1 ? t("One suggested match; review bank evidence before confirming.") : t("No unique match. Review manually in Treasury.")}</p>{row.candidates.map(candidate => <p key={candidate.payableId}><Link to={`/requests/${candidate.requestId}`}>{candidate.requestNumber}</Link>{row.candidates.length === 1 && <button disabled={busy || row.confirmed} onClick={() => setConfirmation(() => async () => { await act(async () => { await api.post(`/operations/statements/${statement.id}/confirm`, { rowIndex: index, payableId: candidate.payableId }); setStatement(previous => ({ ...previous, rows: previous.rows.map((r, i) => i === index ? { ...r, confirmed: true } : r) })); }); setConfirmation(null); })}>{t(row.confirmed ? "Reconciled" : "Confirm reconciliation")}</button>}</p>)}</article>)}</div>}
    <ConfirmDialog open={Boolean(confirmation)} title="Confirm this statement match?" description="Review bank evidence before confirming reconciliation." confirmLabel="Confirm reconciliation" loading={busy} onClose={() => !busy && setConfirmation(null)} onConfirm={() => confirmation?.()} />
    <button className="secondary-button" disabled={busy} onClick={load}>{t("Refresh")}</button>
  </section>;
}
