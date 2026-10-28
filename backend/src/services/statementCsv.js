// Pure statement parser: bank-origin CSV is not trusted. Nothing is posted automatically.
export function parseCsvRecords(text, maxRows = 3000) {
  const input = String(text || "").replace(/^\uFEFF/, "");
  if (input.length > 1_500_000) throw new Error("Statement file is too large.");
  const delimiter = input.split(/\r?\n/, 1)[0].split(";").length > input.split(/\r?\n/, 1)[0].split(",").length ? ";" : ",";
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) { row.push(value); value = ""; }
    else if (char === "\n") {
      row.push(value.replace(/\r$/, "")); value = "";
      if (row.some(cell => String(cell).trim())) rows.push(row);
      if (rows.length > maxRows + 1) throw new Error("Statement has too many rows.");
      row = [];
    } else value += char;
  }
  if (quoted) throw new Error("Statement contains an unterminated CSV quote.");
  row.push(value);
  if (row.some(cell => String(cell).trim())) rows.push(row);
  return rows;
}
export function parseStatement(text) {
  const rows = parseCsvRecords(text);
  if (!rows.length) throw new Error("The statement is empty.");
  const headers = rows.shift().map(v => String(v).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));
  const select = (...names) => headers.findIndex(h => names.includes(h));
  const fields = { date: select("fecha", "date"), reference: select("referencia", "reference", "operacion", "nro operacion"), description: select("descripcion", "description", "concepto"), amount: select("monto", "amount", "importe"), currency: select("moneda", "currency") };
  if (fields.date < 0 || fields.amount < 0 || fields.currency < 0 || fields.reference < 0) throw new Error("Required columns: fecha, referencia, monto, moneda. Optional: descripcion.");
  return rows.map((cols, index) => {
    const rawDate = (cols[fields.date] || "").trim();
    const isoDate = /^\d{2}\/\d{2}\/\d{4}$/.test(rawDate) ? `${rawDate.slice(6)}-${rawDate.slice(3, 5)}-${rawDate.slice(0, 2)}` : rawDate;
    const date = new Date(`${isoDate}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== isoDate) throw new Error(`Row ${index + 2}: invalid date.`);
    const amount = Number(String(cols[fields.amount] || "").trim().replace(/\s/g, ""));
    const currency = String(cols[fields.currency] || "").trim().toUpperCase();
    const reference = String(cols[fields.reference] || "").trim();
    if (!reference || reference.length > 140 || !Number.isFinite(amount) || amount === 0 || !["PEN", "USD"].includes(currency)) throw new Error(`Row ${index + 2}: check reference, amount and currency.`);
    return { date, reference, currency, amount: Math.round(amount * 100) / 100, description: String(cols[fields.description] || "").trim().slice(0, 350), matchStatus: "UNMATCHED" };
  });
}
export function candidateMatches(line, batches) {
  if (line.amount >= 0) return []; // outgoing payments only; incoming credits remain unidentified
  return batches.filter(batch => batch.currency === line.currency && Math.abs(batch.totalAmount + line.amount) <= 0.01 && Math.abs((new Date(batch.paymentDate) - new Date(line.date)) / 86400000) <= 3).map(batch => ({ id: String(batch._id), number: batch.batchNumber }));
}
