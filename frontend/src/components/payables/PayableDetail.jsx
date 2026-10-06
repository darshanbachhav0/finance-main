import { AlertTriangle, Boxes } from "lucide-react";
import PaymentTermsSummary from "../PaymentTermsSummary.jsx";
import StatusBadge from "../StatusBadge.jsx";
import { useLanguage } from "../../context/LanguageContext.jsx";
import { formatCurrency, formatDate, formatDateTime } from "../../utils/formatters.js";
import { netTransfer, supplierLabel, voucherLabel } from "../../utils/payables.js";

function Group({ title, children }) {
  const { t } = useLanguage();
  return <section className="payable-group"><h3>{t(title)}</h3><dl className="detail-grid">{children}</dl></section>;
}

function Field({ label, children }) {
  const { t } = useLanguage();
  return <div><dt>{t(label)}</dt><dd>{children ?? "-"}</dd></div>;
}

// The CXP record, grouped: what is owed, the document, how and when it is paid, accounting,
// then exceptions and history.
export default function PayableDetail({ payable: row }) {
  const { t, language } = useLanguage();
  const money = (currency, value) => formatCurrency(value, currency || "PEN", language);
  const manualException = row.sunatValidation?.manualException || (row.sunatVoucher?.manualOverride?.reason ? { reason: row.sunatVoucher.manualOverride.reason, approvedAt: row.sunatVoucher.manualOverride.overriddenAt, evidenceReference: row.sunatVoucher.manualOverride.evidenceReference } : null);
  const detraction = row.detraction?.status && row.detraction.status !== "NOT_APPLICABLE" ? row.detraction : null;

  return <div className="detail-stack payable-detail">
    {row.status === "PAYMENT_BOUNCED" && <div className="alert-strip error"><AlertTriangle size={18} /><div><strong>{t("PAGO_REBOTADO")}</strong><p>{row.bouncedPayment?.reason || t("The bank rejected this transfer. A signed CCI letter is required before reprogramming.")}</p>{row.bouncedPayment && <p>{t("Reference")}: {row.bouncedPayment.bankReference || "-"} · {t("Reported")}: {row.bouncedPayment.bouncedAt ? formatDateTime(row.bouncedPayment.bouncedAt, language) : "-"}</p>}</div></div>}

    <div className="payable-headline">
      <div><span>{t("Outstanding amount")}</span><strong>{money(row.currency, row.outstandingAmount)}</strong></div>
      {detraction && <div><span>{t("Bank transfer")}</span><strong>{money(row.currency, netTransfer(row))}</strong></div>}
      <div><span>{t("Status")}</span><StatusBadge status={row.status} /></div>
      <div><span>{t("Due date")}</span><strong>{row.dueDate ? formatDate(row.dueDate, language) : row.paymentTermsSnapshot?.paymentCondition ? t("Date to be confirmed under the agreed terms") : "-"}</strong></div>
    </div>

    <Group title="Amounts">
      <Field label="Original amount">{money(row.currency, row.originalAmount)}</Field>
      <Field label="Outstanding amount">{money(row.currency, row.outstandingAmount)}</Field>
      <Field label="PEN equivalent">{money("PEN", row.penEquivalent)}</Field>
      {row.invoiceAmount !== undefined && row.adjustments?.length > 0 && <Field label="Original invoice amount">{money(row.currency, row.invoiceAmount)}</Field>}
    </Group>

    {detraction && <Group title="Detraction (SPOT)">
      <Field label="Status"><StatusBadge status={detraction.status} /></Field>
      <Field label="Category">{[detraction.categoryCode, detraction.categoryDescription].filter(Boolean).join(" - ")}</Field>
      <Field label="Detraction rate">{detraction.rate !== undefined ? `${detraction.rate}%` : "-"}</Field>
      <Field label="Deposit amount">{money("PEN", detraction.amountPen ?? detraction.amount)}</Field>
      <Field label="Bank transfer">{money(row.currency, netTransfer(row))}</Field>
      {detraction.status === "DEPOSITED" && <Field label="Deposit">{[detraction.constancyNumber, detraction.depositDate && formatDate(detraction.depositDate, language)].filter(Boolean).join(" · ")}</Field>}
    </Group>}

    <Group title="Document">
      <Field label="Supplier">{supplierLabel(row)}</Field>
      <Field label="Voucher">{voucherLabel(row)}</Field>
      <Field label="SUNAT validation"><StatusBadge status={row.sunatVoucher?.sunatStatus || row.sunatVoucher?.validationStatus || "NOT_REQUIRED"} /></Field>
      <Field label="Track"><StatusBadge status={row.flowType || row.request?.flowType} /></Field>
      <Field label="Mass upload batch">{row.sourceBatch?.batchCode}</Field>
      <Field label="Accounting period">{row.accountingPeriod}</Field>
    </Group>

    {manualException && <div className="alert-strip warning"><AlertTriangle size={18} /><div><strong>{t("Manual SUNAT exception")}</strong><p>{manualException.reason}</p><p>{t("Approved by Accounting on")} {formatDateTime(manualException.approvedAt, language)}{manualException.evidenceReference ? ` · ${t("Evidence")}: ${manualException.evidenceReference}` : ""}</p></div></div>}

    <Group title="Payment">
      <Field label="Priority"><StatusBadge status={row.paymentPriority || "NORMAL"} /></Field>
      <Field label="Payment Terms"><PaymentTermsSummary terms={row.paymentTermsSnapshot} showAmounts={false} /></Field>
      <Field label="Payment destination">{row.bankAccountSnapshot?.bank ? `${row.bankAccountSnapshot.bank} · ${t(row.bankAccountSnapshot.sourceType || "SUPPLIER")}` : null}</Field>
      <Field label="Payment batch">{row.paymentBatch?.batchNumber}</Field>
    </Group>

    {row.purchaseOrder && <section className="payable-group"><h3>{t("Purchase Order")} {row.purchaseOrder.poNumber}</h3><div className="purchase-order-balance-grid"><div><Boxes size={17} /><span>{t("Original")}</span><strong>{money(row.currency, row.purchaseOrder.originalAmount)}</strong></div><div><span>{t("Consumed")}</span><strong>{money(row.currency, row.purchaseOrder.consumedAmount)}</strong></div><div><span>{t("Remaining")}</span><strong>{money(row.currency, row.purchaseOrder.remainingAmount)}</strong></div></div></section>}

    <Group title="Accounting">
      <Field label="Provision entry">{row.provisionJournal?.entryNumber}</Field>
      <Field label="Payment entry">{row.paymentJournal?.entryNumber}</Field>
    </Group>

    {row.adjustments?.length > 0 && <section className="payable-group"><h3>{t("Credit and debit notes")}</h3><div className="compact-lines">{row.adjustments.map((item) => <div key={item._id || `${item.series}-${item.number}`}><span>{t(item.kind === "CREDIT_NOTE" ? "Credit note" : "Debit note")} {item.series}-{item.number} · {money(row.currency, item.amount)} · {t("Period")} {item.period}{item.supplierCreditAmount > 0 ? ` · ${t("Supplier credit")}: ${money(row.currency, item.supplierCreditAmount)}` : ""}</span></div>)}</div></section>}

    {row.cancellation?.reason && <section className="payable-group"><h3>{t("Cancellation")}</h3><p>{row.cancellation.reason}</p><p>{t("Reversal posted in period")} {row.cancellation.period || "-"}</p></section>}

    <section className="payable-group"><h3>{t("CXP history")}</h3><div className="compact-lines">{(row.history || []).map((item) => <div key={item._id || `${item.status}-${item.at}`}><span>{formatDateTime(item.at, language)} - {item.comments || t(item.status)}</span><StatusBadge status={item.status} /></div>)}{!row.history?.length && <p>-</p>}</div></section>
  </div>;
}
