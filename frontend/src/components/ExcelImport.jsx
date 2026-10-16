import { CheckCircle2, FileSpreadsheet, FileUp, TriangleAlert } from "lucide-react";
import { useState } from "react";
import api from "../api/client.js";
import { useLanguage } from "../context/LanguageContext.jsx";
import { useToast } from "../context/ToastContext.jsx";
import { downloadXlsx } from "../utils/xlsx.js";
import Drawer from "./Drawer.jsx";
import Message from "./Message.jsx";

const fill = (text, params = {}) => Object.entries(params).reduce((result, [key, value]) => result.replace(`{${key}}`, value ?? ""), text);
const MONTHS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

// The sheets each import reads (POST /imports/:kind, backend services/excelImportService.js).
// Column names are matched without accents or case, so the person's own sheet works when its
// headers say the same.
export const IMPORT_TEMPLATES = Object.freeze({
  "budget-plans": {
    title: "Import budgets from Excel",
    description: "One row per Cost Center and year. Fill the twelve months, or leave them empty for an annual budget only. Existing budgets are not changed.",
    headers: ["Año", "CECO", "Proyecto", "Monto anual", ...MONTHS],
    example: [new Date().getFullYear() + 1, "1101", "", 120000, ...MONTHS.map(() => 10000)],
    fileName: "plantilla-presupuestos"
  },
  suppliers: {
    title: "Import suppliers from Excel",
    description: "One row per supplier. Each one is created as a proposal: it is checked and approved as usual before it can be paid. Existing RUC/DNI are skipped. Bank accounts are added in the supplier record.",
    headers: ["RUC/DNI", "Razón social", "Nombre comercial", "Correo", "Teléfono", "Contacto", "Dirección", "Bienes o servicios", "Justificación"],
    example: ["20512345678", "EMPRESA EJEMPLO S.A.C.", "Ejemplo", "ventas@ejemplo.pe", "999888777", "Ana Torres", "Av. Lima 123", "Útiles de oficina", "Proveedor habitual de Logística"],
    fileName: "plantilla-proveedores"
  },
  "payment-schedule": {
    title: "Import the payment schedule from Excel",
    description: "One row per request: the date you plan to pay it and, optionally, its priority (Normal or Prioritaria). The payment goes into that payment run; nothing is paid until you generate the bank file.",
    headers: ["Solicitud", "Fecha de pago", "Prioridad"],
    example: ["SOL-2026-00012", "30/10/2026", "Normal"],
    fileName: "plantilla-cronograma-pagos"
  }
});

// "Import from Excel": download the template, choose the file, check it (nothing is saved), then
// import the rows that are correct. Each row says what will happen or what is wrong.
export default function ExcelImport({ kind, onImported, buttonClassName = "secondary-button" }) {
  const { t } = useLanguage();
  const { notify } = useToast();
  const template = IMPORT_TEMPLATES[kind];
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function close() {
    if (busy) return;
    setOpen(false);
    setFile(null);
    setResult(null);
    setError("");
  }

  async function send(dryRun) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const data = new FormData();
      data.append("file", file);
      const response = await api.post(`/imports/${kind}`, data, { params: { dryRun: String(dryRun) }, headers: { "Content-Type": "multipart/form-data" } });
      setResult(response.data.data);
      if (!dryRun) {
        notify(t("{ok} rows imported, {failed} with errors").replace("{ok}", response.data.data.ok).replace("{failed}", response.data.data.failed), response.data.data.failed ? "warning" : "success");
        onImported?.(response.data.data);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const checked = result?.dryRun;
  const imported = result && !result.dryRun;
  return <>
    <button type="button" className={buttonClassName} onClick={() => setOpen(true)}><FileSpreadsheet size={16} aria-hidden="true" /><span>{t("Import from Excel")}</span></button>
    <Drawer open={open} title={template.title} description={template.description} onClose={close} error={error} footer={<div className="excel-import-actions">
      {!imported && <button type="button" className="secondary-button" disabled={!file || busy} onClick={() => send(true)}>{t(busy && !checked ? "Checking..." : "Check the file")}</button>}
      {checked && result.ok > 0 && <button type="button" className="primary-button" disabled={busy} onClick={() => send(false)}>{t(busy ? "Importing..." : "Import {count} rows").replace("{count}", result.ok)}</button>}
      {imported && <button type="button" className="primary-button" onClick={close}>{t("Done")}</button>}
    </div>}>
      <div className="excel-import">
        <ol className="excel-import-steps">
          <li><span>{t("Download the template, or use your own sheet with the same column names.")}</span><button type="button" className="text-button" onClick={() => downloadXlsx([template.headers, template.example], template.fileName, { sheetName: "Datos" })}><FileSpreadsheet size={15} aria-hidden="true" />{t("Download template")}</button></li>
          <li><label className={`quick-file${file ? " is-attached" : ""}`}><FileUp size={18} aria-hidden="true" /><span><strong>{file?.name || t("Choose the Excel file (.xlsx)")}</strong><small>{t("Up to 500 rows, 2 MB")}</small></span><input type="file" accept=".xlsx" aria-label={t("Choose the Excel file (.xlsx)")} onChange={(event) => { setFile(event.target.files?.[0] || null); setResult(null); event.target.value = ""; }} /></label></li>
          <li><span>{t("Check it: nothing is saved until you import.")}</span></li>
        </ol>
        <Message type="error">{error}</Message>
        {result && <div className="excel-import-result" role="status">
          <p><strong>{t(imported ? "{ok} imported, {failed} with errors" : "{ok} ready to import, {failed} with errors").replace("{ok}", result.ok).replace("{failed}", result.failed)}</strong></p>
          <ul>{result.rows.map((row) => <li key={row.row} className={row.ok ? "is-ok" : "is-error"}>{row.ok ? <CheckCircle2 size={15} aria-hidden="true" /> : <TriangleAlert size={15} aria-hidden="true" />}<span>{t("Row {row}").replace("{row}", row.row)}: {row.ok ? row.summary : fill(t(row.message), row.params)}</span></li>)}</ul>
        </div>}
      </div>
    </Drawer>
  </>;
}
