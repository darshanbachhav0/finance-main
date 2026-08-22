import mongoose from "mongoose";

const projectSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, trim: true, uppercase: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    costCenter: { type: mongoose.Schema.Types.ObjectId, ref: "CostCenter" },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

projectSchema.index({ active: 1, name: 1 });

export default mongoose.model("Project", projectSchema);

