import { BALANCE_TIMINGS, CREDIT_STARTS, PAYMENT_CONDITIONS, normalizePaymentTerms, validatePaymentTerms } from "../../../shared/paymentTerms.mjs";

export const paymentTermFields = {
  paymentConditions: { type: String, trim: true, default: "" },
  paymentCondition: { type: String, enum: [...Object.keys(PAYMENT_CONDITIONS), null], default: null },
  advancePercentage: { type: Number, default: null },
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
  const errors = validatePaymentTerms(value, { requireComplete: false });
  for (const error of errors) this.invalidate(error.field, error.message);
  if (!errors.length) Object.assign(this, normalizePaymentTerms(value));
}
