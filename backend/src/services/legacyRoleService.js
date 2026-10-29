import mongoose from "mongoose";
import { AUTO_RETIRED_ROLES } from "../utils/constants.js";

// Moves what is still stored under an automatically retired role to the role that took over its
// work (Budget -> Treasury): users, their previous role, and approval-rule stages. The roles
// retired with the canonical catalog (SuperAdmin, Procurement, ManagementViewer) are read through
// RETIRED_ROLES at run time and rewritten only by scripts/migrateCanonicalRoles.js, after its dry run. Run at server start,
// before requests are served, so nobody is locked out by a role the app no longer knows; running
// it again changes nothing. Writes go straight to the collections (the models no longer accept the
// retired value) and each moved user gets an audit record.
export async function migrateRetiredRoles({ apply = true, db = mongoose.connection.db, retired: retiredRoles = AUTO_RETIRED_ROLES } = {}) {
  const users = db.collection("users");
  const rules = db.collection("approvalrules");
  const audits = db.collection("auditlogs");
  const summary = {};
  for (const [retired, replacement] of Object.entries(retiredRoles)) {
    const affected = await users.find({ role: retired }).project({ _id: 1, name: 1 }).toArray();
    const previous = await users.countDocuments({ previousRole: retired });
    const ruleCount = await rules.countDocuments({ role: retired });
    summary[retired] = { replacement, users: affected.length, previousRoles: previous, approvalRules: ruleCount };
    if (!apply || (!affected.length && !previous && !ruleCount)) continue;
    const now = new Date();
    if (affected.length) {
      await users.updateMany({ role: retired }, { $set: { role: replacement, updatedAt: now } });
      await audits.insertMany(affected.map((user) => ({
        entityType: "User", entityId: user._id, action: "ROLE_RETIRED", module: "USER_ADMIN", actorName: "System",
        comments: `The ${retired} role was retired; its work now belongs to ${replacement}.`,
        oldValues: { role: retired }, newValues: { role: replacement }, createdAt: now, updatedAt: now
      })));
    }
    if (previous) await users.updateMany({ previousRole: retired }, { $set: { previousRole: replacement } });
    if (ruleCount) await rules.updateMany({ role: retired }, { $set: { role: replacement, updatedAt: now } });
  }
  return summary;
}
