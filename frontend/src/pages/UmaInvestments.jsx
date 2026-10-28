import DateInput from "../components/DateInput.jsx";
import {useEffect,useState} from 'react';
import api from '../api/client.js';
import PageHeader from '../components/PageHeader.jsx';
import {useAuth} from '../context/AuthContext.jsx';
const seed={institution:'',currency:'PEN',principal:'',annualRate:'',startDate:'',maturityDate:''};
export default function UmaInvestments(){
 const {user,readOnly}=useAuth();const [form,setForm]=useState(seed),[rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const create=!readOnly&&['Admin','Treasury'].includes(user?.role),approve=!readOnly&&user?.role==='GAF';
 async function refresh(){try{const r=await api.get('/investments');setRows(r.data.data||[]);}catch(e){setError(e.message);}}
 useEffect(()=>{refresh();},[]);
 async function save(e){e.preventDefault();setBusy(true);setError('');try{await api.post('/investments',form);setForm(seed);await refresh();}catch(e){setError(e.response?.data?.message||e.message);}finally{setBusy(false);}}
 async function confirm(row){const certificateReference=window.prompt('Referencia del certificado bancario:');if(!certificateReference?.trim())return;try{await api.post(`/investments/${row._id}/approve`,{certificateReference});await refresh();}catch(e){setError(e.response?.data?.message||e.message);}}
 async function settle(row){const reference=window.prompt('Referencia del abono recibido:');if(!reference?.trim())return;const principal=window.prompt('Capital recibido:',row.principal);if(principal===null)return;const interest=window.prompt('Interés recibido:');if(interest===null)return;try{await api.post(`/investments/${row._id}/settle`,{reference,principal:Number(principal),interest:Number(interest)});await refresh();}catch(e){setError(e.response?.data?.message||e.message);}}
 return <section className="uma-module"><PageHeader title="Investments" description="Terms, maturities, proposals and financial validation." />
 <p className="uma-notice">Los registros de inversión no generan transferencias ni asientos contables. Tesorería debe confirmar las operaciones y Contabilidad registrar los asientos por su proceso vigente.</p>
 {error&&<p className="uma-error" role="alert">{error}</p>}
 {create&&<form className="uma-panel uma-form" onSubmit={save}><h2>Proponer inversión</h2><label>Entidad financiera<input required maxLength={180} value={form.institution} onChange={e=>setForm(v=>({...v,institution:e.target.value}))}/></label><label>Moneda<select value={form.currency} onChange={e=>setForm(v=>({...v,currency:e.target.value}))}><option>PEN</option><option>USD</option></select></label><label>Capital<input type="number" min="0.01" step="0.01" required value={form.principal} onChange={e=>setForm(v=>({...v,principal:e.target.value}))}/></label><label>TEA %<input type="number" min="0" max="100" step="0.01" required value={form.annualRate} onChange={e=>setForm(v=>({...v,annualRate:e.target.value}))}/></label><label>Inicio<DateInput required value={form.startDate} onChange={e=>setForm(v=>({...v,startDate:e.target.value}))}/></label><label>Vencimiento (máximo 360 días)<DateInput required value={form.maturityDate} onChange={e=>setForm(v=>({...v,maturityDate:e.target.value}))}/></label><button disabled={busy}>{busy?'Registrando…':'Registrar propuesta'}</button></form>}
 <div className="uma-table-wrap"><table className="uma-table"><thead><tr><th>Referencia</th><th>Entidad</th><th>Capital</th><th>TEA</th><th>Rendimiento previsto</th><th>Vencimiento</th><th>Estado</th><th></th></tr></thead><tbody>{rows.map(r=><tr key={r._id}><td>{r.number}</td><td>{r.institution}</td><td>{r.currency} {Number(r.principal).toFixed(2)}</td><td>{r.annualRate}%</td><td>{Number(r.estimatedInterest).toFixed(2)}</td><td>{new Date(r.maturityDate).toLocaleDateString('es-PE')}</td><td>{r.status}</td><td>{approve&&r.status==='PROPOSED'&&<button onClick={()=>confirm(r)}>Validar</button>}{create&&r.status==='ACTIVE'&&<button onClick={()=>settle(r)}>Liquidar</button>}</td></tr>)}</tbody></table></div>
 </section>;
}
