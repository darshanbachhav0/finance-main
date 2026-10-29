import { useState } from "react";
import api from "../api/client.js";

const id = (value) => String(value?._id || value || "");
const roles = { RECEIVER: "Receiver", RESPONSIBLE: "Cost-center responsible", VICE_RECTOR: "Vice-Rector" };
export default function DigitalActaPanel({ request, user, readOnly = false, onSaved }) {
  const [conformity, setConformity] = useState("TOTAL");
  const [description, setDescription] = useState("");
  const [milestone, setMilestone] = useState("");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const acta = request.digitalActa;
  const userId = id(user?._id);
  const canIssue = !readOnly && !acta && userId && userId === id(request.requester || request.solicitor) && ["APROBADO", "COMPROMISO_PRESUPUESTAL", "CONTABILIZADO", "PROGRAMADO", "TXT_GENERADO", "PAGADO", "CONCILIADO", "RENDICION_PENDIENTE", "CERRADO", "PAGO_REBOTADO"].includes(request.status);
  const canReturn = !readOnly && request.flowType === "B" && acta && acta.conformity !== "TOTAL" &&
    (user?.role === "Accounting" || (user?.roles || []).includes("Accounting"));
  const [correctionReason, setCorrectionReason] = useState("");
  const canSign = !readOnly && acta?.status === "PENDING" &&
    [acta.responsible, acta.viceRector].some((signer) => id(signer) === userId) &&
    !(acta.signatures || []).some((sig) => id(sig.signer) === userId);
  async function submit(path, body) {
    setWorking(true); setError("");
    try { await api.post(`/requests/${request._id}/acta/${path}`, body); await onSaved?.(); }
    catch (e) { setError(e.message || "Could not update digital acta."); }
    finally { setWorking(false); }
  }
  async function requestCorrection() {
    if (correctionReason.trim().length < 10) { setError("A reason of at least 10 characters is required."); return; }
    await submit("correction", { reason: correctionReason.trim() });
  }
  async function downloadPdf() {
    setWorking(true); setError("");
    try {
      const response = await api.get(`/requests/${request._id}/acta/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(new Blob([response.data], { type: "application/pdf" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ACTA-${String(request.requestNumber || request._id).replace(/[^\w-]/g, "_")}.pdf`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message || "Could not download acta PDF."); }
    finally { setWorking(false); }
  }
  return <div className="subsection-block" aria-label="Digital acceptance certificate">
    <h4>Acta digital de conformidad</h4>
    <p>Authenticated electronic sign-off. This does not represent a certified digital signature.</p>
    {error && <p role="alert" className="text-danger">{error}</p>}
    {request.flowType === "B" && request.advanceEvidence && <p role={request.advanceEvidence.actaOverdue || request.advanceEvidence.invoiceOverdue ? "alert" : undefined}>
      <strong>Advance documentation deadlines:</strong> invoice {request.advanceEvidence.invoiceComplete ? "received" : `due ${request.advanceEvidence.invoiceDue}${request.advanceEvidence.invoiceOverdue ? " (OVERDUE)" : ""}`}; acta {request.advanceEvidence.actaComplete ? "signed" : `due ${request.advanceEvidence.actaDue}${request.advanceEvidence.actaOverdue ? " (OVERDUE)" : ""}`}.
    </p>}
    {acta ? <>
      <p><strong>Status:</strong> {acta.status} · <strong>Reception:</strong> {acta.conformity}</p>
      <p><strong>Goods/services received:</strong> {acta.description}</p>
      {acta.milestone && <p><strong>Contract milestone:</strong> {acta.milestone}</p>}
      <p><strong>SHA-256 fingerprint:</strong> <code>{acta.documentHash}</code></p>
      <ul>{(acta.signatures || []).map((item, i) => <li key={item._id || i}>{roles[item.as] || item.as} — {new Date(item.signedAt).toLocaleString()} · {item.signature}</li>)}</ul>
      {canSign && <button type="button" className="primary-button" disabled={working} onClick={() => submit("sign")}>Sign this acta</button>}
      {acta.status === "COMPLETE" && <button type="button" disabled={working} onClick={downloadPdf}>Download signed acta (PDF)</button>}
      {acta.status === "OBSERVED" && <p>Non-conforming reception: Accounting must handle the difference or return before posting.</p>}
      {canReturn && <div className="subsection-block">
        <label>Accounting correction reason <textarea value={correctionReason} onChange={e => setCorrectionReason(e.target.value)} minLength={10} maxLength={2000} /></label>
        <p>Return the partial/non-conforming acta to the receiver for a new conformity record. Existing signatures and hash remain in the audit history.</p>
        <button type="button" disabled={working || correctionReason.trim().length < 10} onClick={requestCorrection}>Request corrected acta</button>
      </div>}
    </> : canIssue ? <form onSubmit={(e) => { e.preventDefault(); submit("issue", { conformity, description, milestone }); }}>
      <label>Conformity <select required value={conformity} onChange={e => setConformity(e.target.value)}><option value="TOTAL">Total</option><option value="PARTIAL">Partial</option><option value="NON_CONFORMING">Non-conforming</option></select></label>
      <label>What was received? <textarea required minLength={5} maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label>Contract milestone (optional) <input maxLength={250} value={milestone} onChange={e => setMilestone(e.target.value)} /></label>
      <p>Issuing the acta records your electronic signature as the receiver. Responsible manager and (above 5 UIT) Vice-Rector sign separately.</p>
      <button className="primary-button" disabled={working || description.trim().length < 5}>Issue and sign acta</button>
    </form> : <p>The acta is not issued. Only the approved request's receiver may issue it.</p>}
  </div>;
}
