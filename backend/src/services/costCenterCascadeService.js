import CostCenter from "../models/CostCenter.js";
import User from "../models/User.js";
import { MAX_APPROVAL_CHAIN_DEPTH, ROLES, VICE_RECTORATE_LEVEL } from "../utils/constants.js";

// The Motor de Ingresos cascade of cost centers (CostCenter.parentCode / level / line), as the
// approval route and request visibility read it (Manual técnico, "Ruta de aprobación").

const CASCADE_FIELDS = "code name area parentCode level line responsible active";
const idOf = (value) => String(value?._id || value || "");

export async function loadCascade() {
  const centers = await CostCenter.find({}).select(CASCADE_FIELDS).lean();
  return { centers, byCode: new Map(centers.map((center) => [center.code, center])), byId: new Map(centers.map((center) => [idOf(center._id), center])) };
}

// The CECOs above `center`, nearest first. A cycle or an over-deep cascade stops the walk.
export function ancestorsIn(cascade, center) {
  const out = [];
  const seen = new Set([center?.code]);
  let current = center;
  while (current?.parentCode && out.length < MAX_APPROVAL_CHAIN_DEPTH) {
    const parent = cascade.byCode.get(current.parentCode);
    if (!parent || seen.has(parent.code)) break;
    seen.add(parent.code);
    out.push(parent);
    current = parent;
  }
  return out;
}

// The superior of a CECO in the cascade: the Vicerrectorado (level 4) it depends on, otherwise its
// parent (the Gerente of an administrative area). The root (Junta General) is nobody's superior,
// and a superior without a responsible hands over to the next CECO up that has one.
export function superiorCostCenterIn(cascade, center) {
  const ancestors = ancestorsIn(cascade, center);
  const viceRectorate = ancestors.findIndex((item) => Number(item.level) === VICE_RECTORATE_LEVEL);
  const candidates = ancestors.slice(viceRectorate >= 0 ? viceRectorate : 0).filter((item) => item.parentCode);
  return candidates.find((item) => item.responsible) || null;
}

// Every CECO at or below `roots` in the cascade, as ids.
export function descendantIdsIn(cascade, roots) {
  const children = new Map();
  for (const center of cascade.centers) {
    if (!center.parentCode) continue;
    children.set(center.parentCode, [...(children.get(center.parentCode) || []), center]);
  }
  const ids = new Set();
  const queue = roots.filter(Boolean);
  while (queue.length) {
    const center = queue.shift();
    if (ids.has(idOf(center._id))) continue;
    ids.add(idOf(center._id));
    queue.push(...(children.get(center.code) || []));
  }
  return ids;
}

const CASCADE_VIEWER_ROLES = [ROLES.AREA_DIRECTOR, ROLES.VICE_RECTOR];

// The cost centers whose requests a person sees besides their own (Manual técnico, "Seguridad,
// perfiles y auditoría"): a requester, their own CECO; a Director or Vicerrector, every CECO they
// are responsible for (or their own) and all those below it in the cascade.
export async function visibleCostCenterIdsFor(user) {
  if (!user) return [];
  const cascade = await loadCascade();
  const own = cascade.byId.get(idOf(user.costCenter));
  if (!CASCADE_VIEWER_ROLES.includes(user.role)) return own ? [idOf(own._id)] : [];
  const responsibleFor = cascade.centers.filter((center) => idOf(center.responsible) === idOf(user._id));
  const roots = responsibleFor.length ? responsibleFor : own ? [own] : [];
  return [...descendantIdsIn(cascade, roots)];
}

const HEAD_FIELDS = "name jobTitle active onLeave jefe substitute role approvalLevel area costCenter";
const NOT_AN_AREA = (area) => !area || area === "*" || area.toUpperCase() === "GENERAL";

// Who leads a CECO when it has no responsible: an Area Director or Vice-Rector of its area (their
// area or approval areas), then its top jefe in the roster (someone whose own CECO it is, with
// active reports, whose own jefe is outside it). Active people only, never those in `exclude`.
export async function costCenterHeads(center, { exclude = [] } = {}) {
  const excluded = new Set(exclude.filter(Boolean).map(idOf));
  const area = String(center?.area || "").trim();
  const internal = { active: true, role: { $nin: [ROLES.SUPER_ADMIN, ROLES.AUDITOR, ROLES.MANAGEMENT_VIEWER] } };
  const [directors, people] = await Promise.all([
    NOT_AN_AREA(area) ? [] : User.find({ ...internal, role: { $in: CASCADE_VIEWER_ROLES }, $or: [{ area }, { approvalAreas: area }] }).select(HEAD_FIELDS).sort({ createdAt: 1 }).lean(),
    User.find({ ...internal, costCenter: center?._id }).select(HEAD_FIELDS).sort({ createdAt: 1 }).lean()
  ]);
  const leading = new Set((await User.distinct("jefe", { jefe: { $in: people.map((person) => person._id) }, active: true })).map(String));
  const jefes = await User.find({ _id: { $in: people.map((person) => person.jefe).filter(Boolean) } }).select("costCenter").lean();
  const jefeCenter = new Map(jefes.map((jefe) => [idOf(jefe._id), idOf(jefe.costCenter)]));
  const rosterHeads = people.filter((person) => CASCADE_VIEWER_ROLES.includes(person.role)
    || (leading.has(idOf(person._id)) && jefeCenter.get(idOf(person.jefe)) !== idOf(person.costCenter)));
  const heads = new Map();
  for (const person of [...directors, ...rosterHeads]) if (!excluded.has(idOf(person._id))) heads.set(idOf(person._id), person);
  return [...heads.values()];
}
