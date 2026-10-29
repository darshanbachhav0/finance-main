// Dependency-free PDF rendering for the signed UMA acta. SHA-256 belongs to
// the signed acta payload, not to PDF bytes (PDF pages are renderings of it).
const clean = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
const asciiCompat = (value) => clean(value)
  .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
  .replace(/[\u2013\u2014]/g, "-").replace(/[\u2022]/g, "-")
  .replace(/[\u20ac]/g, "EUR").replace(/[^\u0020-\u007e\u00a1-\u00ff]/g, "?");
const pdfText = (value) => `(${asciiCompat(value).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
const dateTime = (date) => date ? new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "medium", timeStyle: "short" }).format(new Date(date)) : "Pendiente";

export function buildDigitalActaPdf({ request, acta, names = {} }) {
  if (acta?.status !== "COMPLETE") throw new Error("Only a completed acta can be downloaded as a signed PDF.");
  const lines = [];
  const add = (value, type = "normal") => {
    const str = asciiCompat(value);
    if (type === "title") { lines.push({ value: str, type }); return; }
    // Word wrapping prevents long descriptions / signatures from leaving the page.
    const words = str.split(" "); let current = "";
    for (const word of words) {
      if (word.length > 88) {
        if (current) { lines.push({ value: current, type }); current = ""; }
        for (let i = 0; i < word.length; i += 88) lines.push({ value: word.slice(i, i + 88), type });
        continue;
      }
      if ((current + (current ? " " : "") + word).length > 88) { lines.push({ value: current, type }); current = word; }
      else current += (current ? " " : "") + word;
    }
    lines.push({ value: current, type });
  };
  add("UNIVERSIDAD MARIA AUXILIADORA (UMA)", "title");
  add("ACTA DIGITAL DE CONFORMIDAD", "title");
  add("Documento de constancia interna. Firmas electronicas autenticadas, NO firmas digitales certificadas.");
  add("");
  add(`Requerimiento: ${request.requestNumber || request._id}`);
  add(`Via: ${request.flowType || ""} | Tipo: ${request.requestType || ""}`);
  add(`Monto registrado: ${request.currency || "PEN"} ${Number(request.totalAmount || 0).toFixed(2)}`);
  add(`Monto equivalente PEN: ${Number(request.totalPENEquivalent ?? request.penEquivalent ?? 0).toFixed(2)}`);
  add(`Estado del acta: ${acta.status} | Conformidad: ${acta.conformity}`);
  add(`Emitida (Lima): ${dateTime(acta.issuedAt)}`);
  add(`Completada (Lima): ${dateTime(acta.completedAt)}`);
  add("");
  add("DESCRIPCION DE LA RECEPCION", "title");
  add(acta.description || "No declarada");
  if (acta.milestone) add(`Hito: ${acta.milestone}`);
  add("");
  add("FIRMANTES / TRAZABILIDAD", "title");
  for (const sig of acta.signatures || []) {
    const person = names[String(sig.signer)] || "Usuario autenticado";
    add(`${sig.as}: ${person} (${String(sig.signer)})`);
    add(`Fecha (Lima): ${dateTime(sig.signedAt)}`);
    add(`Sello de autenticacion: ${sig.signature || ""}`);
    add(`Hash del acta firmado: ${sig.documentHash || ""}`);
    add("");
  }
  add("HUELLA SHA-256 DEL CONTENIDO DEL ACTA", "title");
  add(acta.documentHash || "Sin huella");
  add("Verificar la huella y los firmantes con el registro original y la auditoria de UMA.");
  const pages = [];
  for (let offset = 0; offset < lines.length; offset += 39) pages.push(lines.slice(offset, offset + 39));
  if (!pages.length) pages.push([]);
  const objects = [null];
  const obj = (value) => { objects.push(value); return objects.length - 1; };
  const catalog = obj("");
  const pagesId = obj("");
  const fontId = obj("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  for (const [index, page] of pages.entries()) {
    const commands = ["BT"];
    let y = 790;
    for (const line of page) {
      const bold = line.type === "title";
      const size = bold ? 12 : 10;
      commands.push(`/F1 ${size} Tf 1 0 0 1 42 ${y} Tm ${pdfText(line.value)} Tj`);
      y -= bold ? 21 : 16;
    }
    commands.push(`/F1 9 Tf 1 0 0 1 42 32 Tm ${pdfText(`UMA - Acta ${request.requestNumber || ""} - Pagina ${index+1}/${pages.length}`)} Tj`);
    commands.push("ET");
    const stream = commands.join("\n") + "\n";
    const streamId = obj(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`);
    const pageId = obj(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[catalog] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  const chunks = [Buffer.from("%PDF-1.4\n%UMA\n", "latin1")];
  const offsets = [0]; let size = chunks[0].length;
  for (let index = 1; index < objects.length; index++) {
    offsets[index] = size;
    const buffer = Buffer.from(`${index} 0 obj\n${objects[index]}\nendobj\n`, "latin1");
    chunks.push(buffer); size += buffer.length;
  }
  const xref = size;
  const xrefText = [`xref`, `0 ${objects.length}`, `0000000000 65535 f `,
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10,"0")} 00000 n `),
    `trailer`, `<< /Size ${objects.length} /Root ${catalog} 0 R >>`, `startxref`, String(xref), `%%EOF`, ""].join("\n");
  chunks.push(Buffer.from(xrefText, "latin1"));
  return Buffer.concat(chunks);
}

