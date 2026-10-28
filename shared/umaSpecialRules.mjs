// Validated request intake for UMA's specialized M/H/E tracks.
// The amounts here are drafts for Accounting, not payment instructions.
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const isoDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0,10) === s;
const text = (value, max=180) => String(value || '').trim().slice(0,max);
const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && round(value) === Number(value);
export const MOBILITY_DAILY_LIMIT = 49.2; // PDF's RMV S/1230 * 4% (subject to Finance setting revisions).
export function computeMobility(lines, dailyLimit=MOBILITY_DAILY_LIMIT) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 150) throw Error('Indique entre 1 y 150 trayectos.');
  const totals = new Map();
  const entries = lines.map((line, i) => {
    if (!isoDate(line.date) || !positive(line.amount) || !text(line.reason)) throw Error(`Trayecto ${i+1}: fecha, motivo e importe válidos son obligatorios.`);
    const date = line.date, amount = round(line.amount);
    totals.set(date, round((totals.get(date) || 0) + amount));
    return {date, amount, reason:text(line.reason,250), from:text(line.from), to:text(line.to)};
  });
  const gross = round(entries.reduce((sum,r)=>sum+r.amount,0));
  const nondeductible = round([...totals.values()].reduce((sum,total)=>sum+Math.max(0,round(total-dailyLimit)),0));
  return { entries, gross, nondeductible, deductible:round(gross-nondeductible), dailyLimit };
}
export function computeHonoraria(lines) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw Error('Indique entre 1 y 200 recibos de honorarios.');
  const seen = new Set();
  const entries = lines.map((line,i)=>{
    const teacher=text(line.teacher,160), receipt=text(line.receipt,50).toUpperCase(), amount=round(line.amount);
    if (!teacher || !receipt || !positive(line.amount) || !/^([A-Z0-9-]{3,50})$/.test(receipt)) throw Error(`Recibo ${i+1}: docente, número e importe requeridos.`);
    const key=`${teacher.toUpperCase()}|${receipt}`;
    if (seen.has(key)) throw Error(`Recibo duplicado: ${receipt}`);
    seen.add(key);
    const suspended = line.suspensionCertificate === true;
    if (suspended && (!isoDate(line.suspensionUntil) || line.suspensionUntil < new Date().toISOString().slice(0,10))) throw Error(`Recibo ${i+1}: la suspensión requiere constancia vigente.`);
    const withholding=amount>1500 && !suspended ? round(amount*0.08):0;
    return {teacher,receipt,amount,withholding,net:round(amount-withholding),suspensionCertificate:suspended,suspensionUntil:suspended?line.suspensionUntil:null};
  });
  return {entries,gross:round(entries.reduce((s,x)=>s+x.amount,0)),withholding:round(entries.reduce((s,x)=>s+x.withholding,0)),net:round(entries.reduce((s,x)=>s+x.net,0))};
}
export function validateStudentRefund(payload) {
  const studentCode=text(payload.studentCode,80),reason=text(payload.reason,600),evidenceNumber=text(payload.evidenceNumber,100);
  const concept=text(payload.concept,6),paymentMethod=text(payload.paymentMethod,20).toUpperCase(),amount=round(payload.amount);
  if (!studentCode || !reason || !evidenceNumber || !/^70410[1-6]$/.test(concept) || !positive(payload.amount) || !['CARD','TRANSFER','CASH'].includes(paymentMethod) || payload.incomeChecked !== true) throw Error('Devolución: alumno, motivo, concepto 704101-704106, comprobación en Motor de Ingresos, medio e importe son obligatorios.');
  return {studentCode,reason,evidenceNumber,concept,paymentMethod,amount,paymentRoute:paymentMethod==='CARD'?'GATEWAY_REVERSAL':'TREASURY_REVIEW'};
}
export function validateSpecialExpense(type,payload) {
  if (type==='M') return {type,...computeMobility(payload.lines),employee: text(payload.employee,160)};
  if (type==='H') return {type,...computeHonoraria(payload.lines)};
  if (type==='E') return {type,...validateStudentRefund(payload)};
  throw Error('Tipo especial no admitido.');
}
