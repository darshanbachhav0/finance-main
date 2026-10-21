import { useEffect, useState } from "react";
import api from "../api/client.js";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";
import ProtectedAssetButton from "./ProtectedAssetButton.jsx";
import "../styles/jefeDashboard.css";

export default function RequestDocumentsDrawer({ requestId, onClose }) {
  const [request, setRequest] = useState(null);
  const [error, setError] = useState("");
  useEffect(() => {
    setRequest(null); setError("");
    if (!requestId) return;
    let active = true;
    api.get(`/requests/${requestId}`).then(response => active && setRequest(response.data.data)).catch(err => active && setError(err.message));
    return () => { active = false; };
  }, [requestId]);
  const attachments = request?.attachments || [];
  const groups = [
    ["Factura", attachments.filter(file => ["XML", "PDF", "FEE_RECEIPT"].includes(file.kind))],
    ["Documentos del proveedor", request?.supplier?.documents || []],
    ["Sustentos", attachments.filter(file => !["XML", "PDF", "FEE_RECEIPT", "PURCHASE_ORDER"].includes(file.kind))],
    ["Orden de compra", attachments.filter(file => file.kind === "PURCHASE_ORDER")]
  ];
  return <Drawer open={Boolean(requestId)} title="View documents" description={request?.requestNumber} onClose={onClose} error={error}>
    {!request && !error && <p role="status">Cargando documentos…</p>}
    {request && groups.map(([title, files]) => files.length > 0 && <section className="document-drawer-group" key={title}>
      <h3>{title}</h3><ul>{files.map((file, index) => {
        const name = file.originalName || file.name || file.documentType || `Documento ${index + 1}`;
        return <li key={file._id || index}><span>{name}</span><div>
          {/\.(pdf|png|jpe?g|webp)$/i.test(name) && <ProtectedAssetButton requestId={requestId} resourcePath={file.url} fileName={name} preview>Vista previa</ProtectedAssetButton>}
          <ProtectedAssetButton requestId={requestId} resourcePath={file.url} fileName={name}>Descargar</ProtectedAssetButton>
        </div></li>;
      })}</ul>
    </section>)}
    {request && groups.every(([, files]) => !files.length) && <Message>No hay documentos adjuntos.</Message>}
  </Drawer>;
}
