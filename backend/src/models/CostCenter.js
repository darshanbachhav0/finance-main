import mongoose from "mongoose";
import { COST_CENTER_LINES } from "../utils/constants.js";

const costCenterSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    // The Motor de Ingresos cascade (data/ceco-cascade.json): the CECO above this one, its level
    // (2 Escuela ... 4 Vicerrectorado ... 7 Gobierno) and its line of cost or expense. The approval
    // route and who sees which requests follow it (services/costCenterCascadeService.js).
    parentCode: { type: String, trim: true, default: null },
    level: { type: Number, min: 1, max: 9 },
    line: { type: String, enum: COST_CENTER_LINES },
    // Responsable del centro de costo: always approves the requests of this CECO, and gives the
    // "visto" when a Por Encargo request is charged to it. Unset: the requester's jefe chain decides.
    responsible: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    annualBudget: { type: Number, default: 0, min: 0 },
    committedAmount: { type: Number, default: 0, min: 0 },
    executedAmount: { type: Number, default: 0, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    budgetMode: { type: String, enum: ["TRANSITIONAL", "ACTIVE"], default: "TRANSITIONAL" },
    availableAmount: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
    organizationalUnit: { type: String, trim: true, default: "" },
    organizationalUnitCode: { type: String, trim: true, default: "" },
    sourceRows: [{ type: Number, min: 2 }],
    importProvenance: {
      source: { type: String, trim: true },
      importedAt: Date,
      sourceSheet: { type: String, trim: true },
      status: { type: String, enum: ["ACTIVE", "INACTIVE", "MANUAL_REVIEW"] }
    }
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
