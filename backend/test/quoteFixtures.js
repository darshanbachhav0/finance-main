import mongoose from "mongoose";

// A1 and B requests are sent with the supplier's quote, its invoice, or both (at least one). Test
// requests built by hand carry the quote: its file as an attachment and the recommended quotation.
export const QUOTE_FILE_ID = new mongoose.Types.ObjectId();
export const quoteAttachment = (uploadedBy) => ({ _id: QUOTE_FILE_ID, kind: "QUOTATION", originalName: "quote.pdf", filename: "quote.pdf", url: "/test/quote.pdf", mimetype: "application/pdf", size: 10, uploadedBy });
export const recommendedQuote = (supplier, amount = 118, currency = "PEN") => ({ supplier, amount, currency, attachment: QUOTE_FILE_ID, recommended: true });
