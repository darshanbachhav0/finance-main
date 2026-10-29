import mongoose from "mongoose";
import AuditLog from "../models/AuditLog.js";
import NotificationDelivery from "../models/NotificationDelivery.js";
import User from "../models/User.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { platformWorkload } from "./dashboardController.js";
import { lastSuccessfulBackup, listBackupRuns, startBackup } from "../services/backupService.js";
import { notificationEmailConfiguration } from "../services/notificationEmailService.js";
import { configurationHealth } from "../services/operationsWorkspaceService.js";
import { currentSettings, SETTINGS_LIMITS, updatePlatformSettings } from "../services/platformSettingsService.js";
import { escapedRegex, paginatedPayload, parsePagination } from "../services/queryService.js";
import { countRecentSecurityAlerts, listSecurityAlerts } from "../services/securityAlertService.js";
import { SECURITY_ALERT_KINDS } from "../services/securityAlertRules.js";
import { getSunatPadronStatus } from "../services/sunatPadronService.js";
import { sunatProviderMode, usesPublicPadron } from "../config/sunatMode.js";
import { AppError } from "../utils/AppError.js";
import { ERROR_CODES, ROLES, SCOPES } from "../utils/constants.js";
import { requestViewScope } from "../utils/permissions.js";
import { ADMINISTRATIVE_AUDIT_MODULES } from "../services/accessReviewService.js";

const context = (req) => ({ actor: req.user, req });

// A status that cannot be read (e.g. a missing Padrón folder) is shown as unknown, never as an error
// that hides the rest of the overview.
async function safely(work, fallback = null) {
  try { return await work(); } catch (error) { return fallback ?? { error: String(error?.message || error).slice(0, 200) }; }
}

const padronMode = () => usesPublicPadron();

export const overview = asyncHandler(async (req, res) => {
  const since = new Date(Date.now() - 86400000);
  const email = notificationEmailConfiguration();
  const [administrators, alerts, health, deliveries, padron, lastBackup, settings, workload, blockedSignIns] = await Promise.all([
    User.countDocuments({ active: true, $or: [{ role: ROLES.ADMIN }, { roles: ROLES.ADMIN }] }),
    countRecentSecurityAlerts(7),
    safely(() => configurationHealth(), { issues: [], error: "Configuration checks could not run." }),
    NotificationDelivery.aggregate([{ $match: { updatedAt: { $gte: since } } }, { $group: { _id: "$status", count: { $sum: 1 } } }]),
    padronMode() ? safely(async () => { const status = await getSunatPadronStatus(); return { mode: "PADRON", ready: status.ready, fresh: status.fresh, workerRunning: Boolean(status.worker?.running) }; }) : { mode: sunatProviderMode() },
    lastSuccessfulBackup(),
    currentSettings(),
    safely(() => platformWorkload(), []),
    AuditLog.countDocuments({ module: "AUTH", action: { $in: ["LOGIN_FAILED", "TWO_FACTOR_FAILED"] }, createdAt: { $gte: since } })
  ]);
  res.json({
    data: {
      administrators: { active: administrators },
      alerts: { lastSevenDays: alerts },
      signIns: { blockedLast24h: blockedSignIns },
      health,
      email: { mode: email.mode, enabled: email.enabled, problems: email.problems, warnings: email.warnings, last24h: Object.fromEntries(deliveries.map((row) => [row._id, row.count])) },
      sunat: padron,
      backup: lastBackup ? { finishedAt: lastBackup.finishedAt, location: lastBackup.location, sizeBytes: lastBackup.sizeBytes } : null,
      maintenance: settings.maintenance,
      announcement: settings.announcement,
      workload,
      checkedAt: new Date()
    }
  });
});

function dayStart(value) { return new Date(`${value}T00:00:00.000Z`); }
function dayEnd(value) { return new Date(`${value}T23:59:59.999Z`); }
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Administrative change history: who changed employees, roles, permissions, cost centers and
// platform settings, and every sign-in. An administrator reads these modules only; Auditoría and the
// GAF (financial history readers) read the whole trail. Audit records are append-only.

function auditScope(user) {
  return requestViewScope(user) === SCOPES.UNIVERSITY ? {} : { module: { $in: ADMINISTRATIVE_AUDIT_MODULES } };
}

export const auditLog = asyncHandler(async (req, res) => {
  const query = req.query || {};
  const filter = auditScope(req.user);
  if (query.actor) {
    if (!mongoose.isValidObjectId(query.actor)) throw new AppError(422, "Choose a valid person.", { field: "actor" }, ERROR_CODES.VALIDATION_ERROR);
    filter.actor = new mongoose.Types.ObjectId(String(query.actor));
  }
  for (const field of ["role", "action", "entityType"]) if (query[field]) filter[field] = String(query[field]);
  if (query.module) filter.module = filter.module ? { $in: filter.module.$in.filter((module) => module === String(query.module)) } : String(query.module);
  if (query.blocked === "true") filter.blocked = true;
  if (query.from || query.to) {
    if ((query.from && !DATE.test(query.from)) || (query.to && !DATE.test(query.to))) throw new AppError(422, "Use dates as YYYY-MM-DD.", undefined, ERROR_CODES.VALIDATION_ERROR);
    filter.createdAt = {};
    if (query.from) filter.createdAt.$gte = dayStart(query.from);
    if (query.to) filter.createdAt.$lte = dayEnd(query.to);
  }
  if (query.search) {
    const search = new RegExp(escapedRegex(String(query.search).slice(0, 80)), "i");
    filter.$or = [{ actorName: search }, { requestNumber: search }, { message: search }, { comments: search }, { action: search }];
  }
  const { page, pageSize, skip } = parsePagination({ ...query, pageSize: query.pageSize || 25 });
  const [rows, total] = await Promise.all([
    AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    AuditLog.countDocuments(filter)
  ]);
  res.json(paginatedPayload(rows, total, page, pageSize));
});

// Values for the audit filters.
export const auditFacets = asyncHandler(async (req, res) => {
  const scope = auditScope(req.user);
  const [modules, actions, entityTypes, roles, actors] = await Promise.all([
    AuditLog.distinct("module", scope),
    AuditLog.distinct("action", scope),
    AuditLog.distinct("entityType", scope),
    AuditLog.distinct("role", scope),
    User.find({ $or: [{ role: ROLES.ADMIN }, { roles: ROLES.ADMIN }] }).select("name role active").sort({ name: 1 }).lean()
  ]);
  const sorted = (values) => values.filter(Boolean).map(String).sort((left, right) => left.localeCompare(right));
  res.json({ data: { modules: sorted(modules), actions: sorted(actions), entityTypes: sorted(entityTypes), roles: sorted(roles), administrators: actors } });
});

export const alerts = asyncHandler(async (req, res) => res.json({ ...(await listSecurityAlerts(req.query)), kinds: SECURITY_ALERT_KINDS }));

export const settings = asyncHandler(async (_req, res) => res.json({ data: await currentSettings(), limits: SETTINGS_LIMITS }));
export const saveSettings = asyncHandler(async (req, res) => res.json({ data: await updatePlatformSettings(req.body || {}, { user: req.user, req }) }));

export const backups = asyncHandler(async (req, res) => res.json(await listBackupRuns(req.query)));
export const runBackup = asyncHandler(async (req, res) => res.status(202).json({ data: await startBackup({ user: req.user, req }) }));
