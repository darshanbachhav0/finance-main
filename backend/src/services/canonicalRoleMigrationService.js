import mongoose from "mongoose";
import {
  canonicalPermission,
  canonicalRole,
  CANONICAL_ROLES,
  GRANTABLE_PERMISSIONS,
  RETIRED_ROLE_GRANTS,
  RETIRED_ROLES,
  ROLES,
  sodViolations
} from "../../../shared/accessControl.mjs";

// Versioned migration to the canonical role and permission catalog (shared/accessControl.mjs).
// It rewrites access configuration only - who holds which role and permission, and which approval
// rules are active. Requests, approval history, invoices, payments, actas and audit logs are never
// touched: a historical approval keeps the role name it was decided under.
//
//   dry run (default) - computes and returns every change, writes nothing
//   apply             - writes the changes, records one audit entry per person and a MigrationRun
//   rollback(report)  - restores the previous values saved in an apply report
//
// Nothing is deleted. Approval rules routed to a role that no longer approves are deactivated, not
// removed. Records that cannot be mapped reliably are flagged (accessReview) for the administrator.
export const CANONICAL_ROLE_MIGRATION_KEY = "2026-10-28-canonical-roles-v1";

const REVIEW_REASONS = Object.freeze({
  ManagementViewer: "Era Management Viewer (portal de gerencia, retirado): ahora Auditoría de solo lectura. Confirme el rol.",
  Procurement: "Era Procurement (Contratos y Abastecimiento, fuera de alcance): ahora Solicitante con el permiso de emitir órdenes de compra. Confirme el rol.",
  SuperAdmin: "Era Super Admin: ahora Administrador del sistema (un solo rol de administración).",
  REQUESTER_KEPT: "Registraba requerimientos con su rol anterior: se le añadió Solicitante para conservar ese acceso. Confirme si lo necesita.",
  NO_SUPERVISOR: "Sin supervisor directo: asigne su jefe para que sus aprobaciones sigan la jerarquía.",
  NO_COST_CENTER: "Sin centro de costo principal: asígnelo antes de que registre requerimientos.",
  SOD_BLOCK: "Combinación de roles prohibida por segregación de funciones: quite uno de los roles."
});

const sameList = (left = [], right = []) => [...left].sort().join(",") === [...right].sort().join(",");

// The new access values for one stored user, with the reasons it needs a person's review.
export function planUserAccess(user) {
  const reasons = [];
  const retiredPrimary = RETIRED_ROLES[user.role] ? user.role : null;
  const role = canonicalRole(user.role) || ROLES.SOLICITOR;
  const extra = new Set((user.roles || []).map(canonicalRole).filter(Boolean));
  const permissions = new Set();
  const droppedPermissions = [];
  for (const value of user.permissions || []) {
    const permission = canonicalPermission(value);
    if (permission && GRANTABLE_PERMISSIONS.includes(permission)) permissions.add(permission);
    else droppedPermissions.push(value);
  }
  for (const grant of RETIRED_ROLE_GRANTS[user.role] || []) permissions.add(grant);
  if (retiredPrimary && REVIEW_REASONS[retiredPrimary] && retiredPrimary !== "Budget") reasons.push(REVIEW_REASONS[retiredPrimary]);
  // Legal and Gestión de Personas registered their area's requests like a Solicitante; their
  // canonical roles no longer do (Legal validates E, Gestión de Personas uploads H), so the
  // Solicitante role is added to keep what they could do, for the administrator to confirm.
  if ([ROLES.LEGAL, ROLES.HUMAN_RESOURCES].includes(role) && !extra.has(ROLES.SOLICITOR)) {
    extra.add(ROLES.SOLICITOR);
    reasons.push(REVIEW_REASONS.REQUESTER_KEPT);
  }
  extra.delete(role);
  const roles = [...extra];
  const all = [role, ...roles];
  if (sodViolations(all).some((rule) => rule.severity === "block")) reasons.push(REVIEW_REASONS.SOD_BLOCK);
  const outsideHierarchy = all.every((item) => [ROLES.ADMIN, ROLES.AUDITOR, ROLES.MANAGEMENT].includes(item));
  if (user.active !== false && !user.jefe && !outsideHierarchy) reasons.push(REVIEW_REASONS.NO_SUPERVISOR);
  if (user.active !== false && !user.costCenter && all.includes(ROLES.SOLICITOR)) reasons.push(REVIEW_REASONS.NO_COST_CENTER);
  const previousRole = user.previousRole ? canonicalRole(user.previousRole) || null : undefined;
  return {
    role,
    roles,
    permissions: [...permissions],
    previousRole,
    droppedPermissions,
    reasons
  };
}

function userChanged(user, plan) {
  return user.role !== plan.role
    || !sameList(user.roles || [], plan.roles)
    || !sameList(user.permissions || [], plan.permissions)
    || (plan.previousRole !== undefined && (user.previousRole || null) !== plan.previousRole)
    || plan.reasons.some((reason) => !(user.accessReview?.reasons || []).includes(reason));
}

// Approval rules may route a step only to a role that approves (never the administrator or
// Auditoría). Rules stored under a retired role move to its replacement when that role approves;
// otherwise they are deactivated so no route can reach them.
function planRule(rule) {
  const role = canonicalRole(rule.role);
  if (role && ![ROLES.ADMIN, ROLES.AUDITOR].includes(role)) return role === rule.role ? null : { role, active: rule.active !== false };
  return rule.active === false ? null : { role: rule.role, active: false };
}

export async function runCanonicalRoleMigration({ apply = false, db = mongoose.connection.db, now = new Date() } = {}) {
  const usersCollection = db.collection("users");
  const rulesCollection = db.collection("approvalrules");
  const audits = db.collection("auditlogs");
  const users = await usersCollection.find({}).project({ name: 1, dni: 1, role: 1, roles: 1, permissions: 1, previousRole: 1, accessReview: 1, jefe: 1, costCenter: 1, active: 1 }).toArray();
  const rules = await rulesCollection.find({}).project({ name: 1, role: 1, active: 1, approvalLevel: 1 }).toArray();

  const userChanges = [];
  for (const user of users) {
    const plan = planUserAccess(user);
    if (!userChanged(user, plan)) continue;
    userChanges.push({
      _id: String(user._id),
      name: user.name,
      dni: user.dni,
      before: { role: user.role, roles: user.roles || [], permissions: user.permissions || [], previousRole: user.previousRole ?? null, accessReview: user.accessReview ?? null },
      after: { role: plan.role, roles: plan.roles, permissions: plan.permissions, previousRole: plan.previousRole ?? user.previousRole ?? null, accessReview: plan.reasons.length ? { required: true, reasons: plan.reasons } : user.accessReview ?? null },
      droppedPermissions: plan.droppedPermissions
    });
  }
  const ruleChanges = rules.map((rule) => ({ rule, plan: planRule(rule) })).filter((item) => item.plan).map(({ rule, plan }) => ({
    _id: String(rule._id), name: rule.name, approvalLevel: rule.approvalLevel,
    before: { role: rule.role, active: rule.active !== false },
    after: plan
  }));

  const byRole = (list) => list.reduce((counts, item) => ({ ...counts, [item]: (counts[item] || 0) + 1 }), {});
  const summary = {
    key: CANONICAL_ROLE_MIGRATION_KEY,
    mode: apply ? "APPLY" : "DRY_RUN",
    users: users.length,
    usersChanged: userChanges.length,
    retiredRoles: byRole(users.filter((user) => RETIRED_ROLES[user.role]).map((user) => user.role)),
    unknownRoles: byRole(users.filter((user) => !RETIRED_ROLES[user.role] && !CANONICAL_ROLES.includes(user.role)).map((user) => String(user.role))),
    permissionsDropped: userChanges.reduce((sum, item) => sum + item.droppedPermissions.length, 0),
    flaggedForReview: userChanges.filter((item) => item.after.accessReview?.required).length,
    approvalRulesChanged: ruleChanges.length,
    approvalRulesDeactivated: ruleChanges.filter((item) => item.after.active === false).length
  };

  if (apply) {
    for (const change of userChanges) {
      const set = { role: change.after.role, roles: change.after.roles, permissions: change.after.permissions, updatedAt: now };
      if (change.after.previousRole !== change.before.previousRole) set.previousRole = change.after.previousRole;
      const known = change.before.accessReview?.reasons || [];
      if (change.after.accessReview?.required && change.after.accessReview.reasons.some((reason) => !known.includes(reason))) {
        set.accessReview = { required: true, reasons: [...new Set([...known, ...change.after.accessReview.reasons])], flaggedAt: now };
      }
      await usersCollection.updateOne({ _id: new mongoose.Types.ObjectId(change._id) }, { $set: set });
    }
    if (userChanges.length) {
      await audits.insertMany(userChanges.map((change) => ({
        entityType: "User", entity: "User", entityId: new mongoose.Types.ObjectId(change._id), action: "ROLES_MIGRATED", module: "USER_ADMIN", actorName: "System",
        comments: `Canonical role migration ${CANONICAL_ROLE_MIGRATION_KEY}.`,
        oldValues: change.before, newValues: { ...change.after, droppedPermissions: change.droppedPermissions }, createdAt: now
      })));
    }
    for (const change of ruleChanges) {
      await rulesCollection.updateOne({ _id: new mongoose.Types.ObjectId(change._id) }, { $set: { role: change.after.role, active: change.after.active, updatedAt: now } });
    }
    await db.collection("migrationruns").updateOne(
      { key: CANONICAL_ROLE_MIGRATION_KEY },
      { $set: { summary, appliedAt: now, updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true }
    );
  }
  return { summary, userChanges, ruleChanges };
}

// Restores what an apply report says each record held before. Only the access fields the
// migration changed are written back; records changed by an administrator since are reported and
// left alone unless force is set.
export async function rollbackCanonicalRoleMigration(report, { db = mongoose.connection.db, force = false, now = new Date() } = {}) {
  if (report?.summary?.key !== CANONICAL_ROLE_MIGRATION_KEY || report.summary.mode !== "APPLY") throw new Error("Pass the JSON report written by an --apply run of this migration.");
  const usersCollection = db.collection("users");
  const rulesCollection = db.collection("approvalrules");
  const restored = [];
  const skipped = [];
  for (const change of report.userChanges || []) {
    const id = new mongoose.Types.ObjectId(change._id);
    const current = await usersCollection.findOne({ _id: id }, { projection: { role: 1, roles: 1, permissions: 1 } });
    if (!current) { skipped.push({ _id: change._id, reason: "missing" }); continue; }
    const untouched = current.role === change.after.role && sameList(current.roles || [], change.after.roles) && sameList(current.permissions || [], change.after.permissions);
    if (!untouched && !force) { skipped.push({ _id: change._id, name: change.name, reason: "changed since the migration" }); continue; }
    const set = { role: change.before.role, roles: change.before.roles, permissions: change.before.permissions, updatedAt: now };
    if (change.before.previousRole !== undefined) set.previousRole = change.before.previousRole;
    set.accessReview = change.before.accessReview || { required: false, reasons: [] };
    await usersCollection.updateOne({ _id: id }, { $set: set });
    restored.push(change._id);
  }
  for (const change of report.ruleChanges || []) {
    await rulesCollection.updateOne({ _id: new mongoose.Types.ObjectId(change._id) }, { $set: { role: change.before.role, active: change.before.active, updatedAt: now } });
  }
  if (restored.length) {
    await db.collection("auditlogs").insertOne({ entityType: "MigrationRun", entity: "MigrationRun", action: "ROLES_MIGRATION_ROLLED_BACK", module: "USER_ADMIN", actorName: "System", comments: `Rolled back ${CANONICAL_ROLE_MIGRATION_KEY}.`, newValues: { restored: restored.length, skipped: skipped.length }, createdAt: now });
  }
  await db.collection("migrationruns").deleteOne({ key: CANONICAL_ROLE_MIGRATION_KEY });
  return { restored: restored.length, rulesRestored: (report.ruleChanges || []).length, skipped };
}
