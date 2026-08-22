import mongoose from "mongoose";

const costCenterSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    annualBudget: { type: Number, default: 0, min: 0 },
    committedAmount: { type: Number, default: 0, min: 0 },
    executedAmount: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    budgetMode: { type: String, enum: ["TRANSITIONAL", "ACTIVE"], default: "TRANSITIONAL" },
    availableAmount: { type: Number, default: 0 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

costCenterSchema.pre("validate", function calculateAvailable(next) {
  this.availableAmount = Number(this.annualBudget || 0) - Number(this.committedAmount || 0) - Number(this.executedAmount || 0);
  next();
});

costCenterSchema.pre("findOneAndUpdate", async function calculateAvailableOnUpdate(next) {
  const update = this.getUpdate();
  const payload = update.$set || update;
  if (payload.annualBudget !== undefined || payload.committedAmount !== undefined || payload.executedAmount !== undefined) {
    const current = await this.model.findOne(this.getQuery());
    const annualBudget = payload.annualBudget !== undefined ? payload.annualBudget : current?.annualBudget || 0;
    const committedAmount = payload.committedAmount !== undefined ? payload.committedAmount : current?.committedAmount || 0;
    const executedAmount = payload.executedAmount !== undefined ? payload.executedAmount : current?.executedAmount || 0;
    payload.availableAmount = Number(annualBudget || 0) - Number(committedAmount || 0) - Number(executedAmount || 0);
    if (update.$set) update.$set = payload;
    else this.setUpdate(payload);
  }
  next();
});

const CostCenter = mongoose.model("CostCenter", costCenterSchema);
export default CostCenter;
