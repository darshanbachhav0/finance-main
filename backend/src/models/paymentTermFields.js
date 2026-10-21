import { BALANCE_TIMINGS, CREDIT_STARTS, PAYMENT_CONDITIONS, normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";

export const paymentTermFields = {
  paymentConditions: { type: String, trim: true, default: "" },
  paymentCondition: { type: String, enum: [...Object.keys(PAYMENT_CONDITIONS), null], default: null },
  advancePercentage: { type: Number, default: null },
  plannedAdvanceAmount: { type: Number, min: 0, default: undefined },
  balancePercentage: { type: Number, default: null },
  balanceTiming: { type: String, enum: [...Object.keys(BALANCE_TIMINGS), null], default: null },
  balanceTimingNotes: { type: String, trim: true, default: "" },
  creditDays: { type: Number, default: null },
  creditStart: { type: String, enum: [...Object.keys(CREDIT_STARTS), null], default: null },
  partialPaymentCount: { type: Number, default: null },
  paymentNotes: { type: String, trim: true, default: "" }
};

export function validateAndNormalizePaymentTerms() {
  const value = this.toObject();
  // Parent request totals are recalculated before subdocument validation. Bind a planned
  // supplier advance to that total, rather than a client-supplied amount or percentage.
  const parent = this.$parent?.();
  const amount = value.amount ?? value.quotationAmount ?? (parent?.supplierPaymentTerms === this ? parent.totalAmount : undefined);
  const errors = validatePaymentTerms({ ...value, amount }, { requireComplete: false });
  for (const error of errors) this.invalidate(error.field, error.message);
  if (!errors.length) Object.assign(this, normalizePaymentTerms(value, amount));
}
