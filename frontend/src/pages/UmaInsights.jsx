import DateInput from "../components/DateInput.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";
import {useEffect,useState} from "react";
import api from "../api/client.js";
import PageHeader from "../components/PageHeader.jsx";
export default function UmaInsights({type="consultas"}) {
 const {t}=useLanguage();
 const [topic,setTopic] = useState("requests"),[currency,setCurrency]=useState(""),[from,setFrom]=useState(""),[to,setTo]=useState(""),[data,setData]=useState(null),[error,setError]=useState("");
 const params={topic,currency,from,to};
 const load=()=>api.get(`/insights/${type}`,{params}).then(r=>{setData(r.data.data);setError("");}).catch(e=>setError(e.message));
 useEffect(()=>{load()},[type]);
 const groups=type==="indicadores"?[{name:"Solicitudes por estado",rows:data?.byStatus},{name:"Solicitudes por prioridad",rows:data?.byPriority},{name:"Lotes bancarios",rows:data?.batches},{name:"Registros especiales",rows:data?.specials},{name:"Investments",rows:data?.investments}]:[];
 return <section className="uma-module"><PageHeader title={type==="indicadores"?"Indicadores":"Consultas"} description="Operational view of the information recorded in UMA Finance." />
 <form className="uma-toolbar" onSubmit={e=>{e.preventDefault();load();}}>{type==="consultas"&&<label>Consulta<select value={topic} onChange={e=>setTopic(e.target.value)}><option value="requests">Solicitudes</option><option value="payables">Cuentas por pagar</option><option value="actas">Actas digitales</option><option value="suppliers">Proveedores</option><option value="bankBatches">Lotes bancarios</option><option value="statementReviews">Extractos</option><option value="specialExpenses">Movilidad / Honorarios / Devoluciones</option><option value="investments">Inversiones</option></select></label>}<label>Desde<DateInput value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Hasta<DateInput value={to} onChange={e=>setTo(e.target.value)}/></label>{type==="consultas"&&<label>Moneda<select value={currency} onChange={e=>setCurrency(e.target.value)}><option value="">Todas</option><option>PEN</option><option>USD</option></select></label>}<button type="submit">Consultar</button>{type==="consultas"&&<button type="button" onClick={async()=>{try{const r=await api.get("/insights/consultas.csv",{params,responseType:"blob"});const url=URL.createObjectURL(r.data);const a=document.createElement("a");a.href=url;a.download="UMA-consultas.csv";a.click();URL.revokeObjectURL(url);}catch(e){setError(e.message);}}}>Exportar CSV</button>}</form>
 {error&&<p className="uma-error">{error}</p>}
 {type==="indicadores" ? <div className="uma-grid">{groups.map(g=><section className="uma-panel" key={g.name}><h2>{t(g.name)}</h2><table className="uma-table"><thead><tr><th>Estado / Prioridad</th><th>Total</th></tr></thead><tbody>{(g.rows||[]).map(r=><tr key={String(r._id)}><td>{r._id||"No registrado"}</td><td>{r.count}</td></tr>)}</tbody></table></section>)}</div> : <div className="uma-table-wrap"><table className="uma-table"><thead><tr><th>Referencia</th><th>Estado</th><th>Proceso</th><th>Moneda</th><th>Importe</th><th>Fecha</th></tr></thead><tbody>{(Array.isArray(data)?data:[]).map(r=><tr key={r._id}><td>{r.reference||r.requestNumber||r.request?.requestNumber||"-"}</td><td>{r.status}</td><td>{r.flowType||"CXP"}</td><td>{r.currency}</td><td>{r.amount??r.totalAmount??r.originalAmount??"-"}</td><td>{new Date(r.createdAt).toLocaleDateString("es-PE")}</td></tr>)}</tbody></table></div>}
 </section>;
}
