import DateInput from "../components/DateInput.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import PageHeader from "../components/PageHeader.jsx";
export default function UmaAudit() {
 const {t}=useLanguage();
 const [filters,setFilters] = useState({from:"",to:"",module:"",search:""});
 const [rows,setRows] = useState([]), [page,setPage] = useState(1),[total,setTotal] = useState(0), [error,setError]=useState("");
 const refresh = () => api.get("/insights/audit", {params:{...filters,page,pageSize:25}}).then(r=>{setRows(r.data.data||[]);setTotal(r.data.pagination?.total||0);setError("");}).catch(e=>setError(e.message));
 useEffect(()=>{refresh();},[page]);
 const change=e=>setFilters(v=>({...v,[e.target.name]:e.target.value}));
 async function exportCsv(){try{const r=await api.get("/insights/audit.csv",{params:filters,responseType:"blob"});const url=URL.createObjectURL(r.data);const a=document.createElement("a");a.href=url;a.download="UMA-auditoria.csv";a.click();URL.revokeObjectURL(url);}catch(e){setError(e.message);}}
 return <section className="uma-module"><PageHeader title="Audit" description="Recorded system events with immutable records and CSV export." />{error && <p className="uma-error">{error}</p>}
 <form className="uma-toolbar" onSubmit={e=>{e.preventDefault();setPage(1);refresh();}}><label>Desde<DateInput name="from" value={filters.from} onChange={change}/></label><label>Hasta<DateInput name="to" value={filters.to} onChange={change}/></label><label>Módulo<input name="module" value={filters.module} onChange={change} placeholder={t("e.g. TREASURY")}/></label><label>Buscar<input name="search" value={filters.search} onChange={change} placeholder={t("Number or action")}/></label><button type="submit">Filtrar</button><button type="button" onClick={exportCsv}>Descargar CSV</button></form>
 <div className="uma-table-wrap"><table className="uma-table"><thead><tr><th>Fecha</th><th>Actor</th><th>Módulo</th><th>Acción</th><th>Solicitud</th><th>Estado</th></tr></thead><tbody>{rows.map(r=><tr key={r._id}><td>{new Date(r.createdAt).toLocaleString("es-PE")}</td><td>{r.actorName||r.role||"Sistema"}</td><td>{r.module}</td><td>{r.action}</td><td>{r.requestNumber||"-"}</td><td>{r.statusFrom&&r.statusTo?`${r.statusFrom} → ${r.statusTo}`:r.blocked?"Bloqueado":"-"}</td></tr>)}</tbody></table></div><div className="uma-toolbar"><span>{total} eventos</span><button type="button" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Anterior</button><span>{page}</span><button type="button" disabled={page*25>=total} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div></section>;
}
