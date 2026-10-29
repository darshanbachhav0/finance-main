import { useLanguage } from "../context/LanguageContext.jsx";
import { useEffect, useState } from "react";
import api from "../api/client.js";
import PageHeader from "../components/PageHeader.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { PERMISSIONS, userCan } from "../utils/access.js";

export default function UmaStatementReviews() {
 const {t}=useLanguage();
 const { user, readOnly } = useAuth();
 const { notify } = useToast();
 const [rows, setRows] = useState([]), [selected, setSelected] = useState(null), [decisions,setDecisions]=useState([]), [file, setFile] = useState(null), [bank, setBank] = useState("BBVA"), [error, setError] = useState(""), [busy, setBusy] = useState(false);
 const canUpload = !readOnly && userCan(user, PERMISSIONS.RECONCILIATION_PREPARE);
 const canSign = !readOnly && userCan(user, PERMISSIONS.RECONCILIATION_SIGN);
 const refresh = () => api.get("/statement-reviews").then(r => setRows(r.data.data || [])).catch(e=>setError(e.message));
 useEffect(()=>{refresh()},[]);
 async function open(id){ try { const r=await api.get(`/statement-reviews/${id}`);setSelected(r.data.data);setDecisions((r.data.data.lines||[]).map(l=>({decision:l.matchStatus==="SUGGESTED"?"ACCEPT":"UNIDENTIFIED",notes:""}))); }catch(e){setError(e.message);} }
 async function send(e){e.preventDefault();if(!file)return;setBusy(true);try{const form=new FormData();form.append("statement",file);form.append("bankName",bank);const r=await api.post("/statement-reviews",form);notify("Extracto importado para revisión.");setSelected(r.data.data);setDecisions((r.data.data.lines||[]).map(l=>({decision:l.matchStatus==="SUGGESTED"?"ACCEPT":"UNIDENTIFIED",notes:""})));await refresh();}catch(e){setError(e.message);}finally{setBusy(false);}}
 async function prepare(){try{const r=await api.post(`/statement-reviews/${selected._id}/prepare`,{decisions});setSelected(r.data.data);notify("Movimientos clasificados para Contabilidad.");await refresh();}catch(e){setError(e.response?.data?.message||e.message);}}
 async function sign(){try{const r=await api.post(`/statement-reviews/${selected._id}/review`, {notes:"Revisión de extracto realizada. Conciliación contable pendiente."});setSelected(r.data.data);notify("Revisión firmada.");await refresh();}catch(e){setError(e.message);}}
 return <section className="uma-module"><PageHeader title="Reconciliation · Bank statements" description="CSV import, suggested matches and Accounting review." />
 <p className="uma-notice">Las coincidencias son sugerencias; esta pantalla no contabiliza movimientos ni cambia por sí sola el estado de pago o conciliación.</p>
 {error && <p className="uma-error" role="alert">{error}</p>}
 {canUpload && <form className="uma-toolbar uma-panel" onSubmit={send}><label>Banco<input value={bank} onChange={e=>setBank(e.target.value)} required maxLength="100"/></label><label>Extracto CSV<input type="file" accept=".csv,text/csv" required onChange={e=>setFile(e.target.files[0]||null)}/></label><button type="submit" disabled={busy}>{busy?"Importando...":"Importar"}</button></form>}
 <p>Columnas requeridas: <code>fecha;referencia;monto;moneda</code>. Opcional: <code>descripcion</code>. Los pagos salientes deben tener importe negativo.</p>
 <div className="uma-table-wrap"><table className="uma-table"><thead><tr><th>Extracto</th><th>Banco</th><th>Fecha</th><th>Estado</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r._id}><td>{r.sourceName}</td><td>{r.bankName}</td><td>{new Date(r.createdAt).toLocaleString("es-PE")}</td><td>{r.status}</td><td><button onClick={()=>open(r._id)}>Revisar</button></td></tr>)}</tbody></table></div>
 {selected && <section className="uma-panel"><div className="uma-toolbar"><h2>Extracto: {selected.sourceName}</h2>{canUpload&&selected.status==="PENDING_ACCOUNTING"&&<button onClick={prepare}>Enviar a Contabilidad</button>}{canSign && selected.status==="READY_FOR_ACCOUNTING" && String(selected.importedBy?._id||selected.importedBy)!==String(user._id) && <button onClick={sign}>Firmar revisión (no contabiliza)</button>}</div><p>{selected.lines?.length || 0} movimientos · {selected.status}</p><div className="uma-table-wrap"><table className="uma-table"><thead><tr><th>Fecha</th><th>Operación</th><th>Concepto</th><th>Moneda</th><th>Importe</th><th>Coincidencia</th><th>Clasificación de Tesorería</th></tr></thead><tbody>{(selected.lines||[]).map((r,i)=><tr key={i}><td>{new Date(r.date).toLocaleDateString("es-PE")}</td><td>{r.reference}</td><td>{r.description}</td><td>{r.currency}</td><td>{r.amount.toFixed(2)}</td><td>{r.matchStatus} {r.candidates?.length ? `(${r.candidates.join(", ")})` : ""}</td><td>{canUpload&&selected.status==="PENDING_ACCOUNTING"?<><select aria-label={`Clasificar movimiento ${i+1}`} value={decisions[i]?.decision||"UNIDENTIFIED"} onChange={e=>setDecisions(v=>v.map((d,j)=>j===i?{...d,decision:e.target.value}:d))}><option value="ACCEPT" disabled={r.matchStatus!=="SUGGESTED"}>Aceptar coincidencia</option><option value="UNIDENTIFIED">Por identificar</option><option value="REJECT">Descartar coincidencia</option></select>{decisions[i]?.decision!=="ACCEPT"&&<input aria-label={`Motivo ${i+1}`} placeholder={t("Reason")} value={decisions[i]?.notes||""} onChange={e=>setDecisions(v=>v.map((d,j)=>j===i?{...d,notes:e.target.value}:d))}/>}</>:r.reviewDecision||"Pendiente"}</td></tr>)}</tbody></table></div></section>}
 </section>;
}
