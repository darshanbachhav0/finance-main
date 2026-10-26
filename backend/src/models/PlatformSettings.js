import mongoose from "mongoose";

// Platform-wide settings the Super Admin maintains (services/platformSettingsService.js). One
// document, key "platform". A missing value falls back to the environment default.
const platformSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: "platform" },
    passwordPolicy: {
      minLength: { type: Number, min: 10, max: 72 },
      // 0: passwords never expire.
      expiryDays: { type: Number, min: 0, max: 365 }
    },
    session: {
      userMinutes: { type: Number, min: 15, max: 1440 },
      superAdminMinutes: { type: Number, min: 10, max: 240 }
    },
    // While enabled, only Admin and Super Admin accounts can sign in or use the API.
    maintenance: {
      enabled: { type: Boolean, default: false },
      message: { type: String, trim: true, maxlength: 500 }
    },
    // A banner shown to every signed-in user (and on the sign-in page).
    announcement: {
      enabled: { type: Boolean, default: false },
      message: { type: String, trim: true, maxlength: 500 },
      tone: { type: String, enum: ["info", "warning"], default: "info" }
    },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export default mongoose.model("PlatformSettings", platformSettingsSchema);
