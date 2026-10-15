// The "Help me choose" questions on a new request: who receives the money, whether it was already
// spent, whether the invoice is in hand and whether quotations or a purchase order are needed.
export const TRACK_RESULTS = Object.freeze({
  A1: { flowType: "A1", requestType: "OPEX", title: "Track A1 · Standard procurement", reason: "Buying through quotations and a purchase order issued by Procurement. The invoice is registered against the order later." },
  B: { flowType: "B", requestType: "OPEX", title: "Track B · Direct payment", reason: "You already have the invoice and no quotation or order is needed. It is checked before approval and goes straight to payment once approved." },
  C_ADVANCE: { flowType: "C", requestType: "ENTREGA_RENDIR", title: "Track C · Advance to render", reason: "UMA pays you first and you account for the money with a rendition within the working-day deadline." },
  C_UNDOCUMENTED: { flowType: "C", requestType: "REEMBOLSO_SIN_SUSTENTO", title: "Track C · Undocumented reimbursement", reason: "You already paid a small expense without a receipt. After approval you sign a declaration and Treasury pays your verified account." }
});

// Returns a TRACK_RESULTS key, or null while the answers given do not decide yet.
export function recommendTrack({ payee, spent, hasInvoice, needsOrder } = {}) {
  if (payee === "employee") return spent === "yes" ? "C_UNDOCUMENTED" : spent === "no" ? "C_ADVANCE" : null;
  if (payee === "supplier") {
    if (hasInvoice === "no") return "A1";
    if (hasInvoice === "yes") return needsOrder === "yes" ? "A1" : needsOrder === "no" ? "B" : null;
  }
  return null;
}
