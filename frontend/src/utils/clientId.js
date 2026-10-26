// A key for a row being edited (a request line, a quotation) before the server gives it an id. It
// has no dots: the request form keys its quotation files by it, saved drafts keep those keys, and
// the API refuses field names with "." or "$" (backend/src/middleware/sanitizeInput.js).
export const clientId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

const unsafeKey = (key) => /[.$]/.test(String(key ?? ""));

// Drafts kept before ids lost their dots (in this browser, never accepted by the server): each such
// quotation gets a new id and its file follows it, so the draft can be saved again.
export function withSafeQuotationIds(quotations = [], quotationFiles = {}) {
  const renamed = new Map();
  const safeQuotations = quotations.map((quotation) => {
    if (!unsafeKey(quotation?.clientId)) return quotation;
    const next = clientId();
    renamed.set(String(quotation.clientId), next);
    return { ...quotation, clientId: next };
  });
  const safeFiles = Object.fromEntries(Object.entries(quotationFiles || {})
    .map(([key, file]) => [renamed.get(key) || key, file])
    .filter(([key]) => !unsafeKey(key)));
  return { quotations: safeQuotations, quotationFiles: safeFiles };
}
