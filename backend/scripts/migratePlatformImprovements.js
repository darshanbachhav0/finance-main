import "dotenv/config";
import "../src/config/timeZone.js";
import mongoose from "mongoose";
import { pathToFileURL } from "node:url";
import { connectDB } from "../src/config/db.js";
import { limaDateKey } from "../../shared/businessCalendar.mjs";
import { DEFAULT_REQUEST_PRIORITY, LEGACY_REQUEST_PRIORITY_MAP, REQUEST_PRIORITY_RANK } from "../../shared/requestPriority.mjs";

// Brings existing records in line with the October 2026 request / supplier improvements. It only
// adds missing values: nothing is renumbered, deleted or overwritten, and running it again changes
// nothing.
//
//   node scripts/migratePlatformImprovements.js                         dry run (report only)
//   node scripts/migratePlatformImprovements.js --apply                 numbers, priority, frequency
//   node scripts/migratePlatformImprovements.js --apply --assign-areas  also gives suppliers areas
//
// 1. Suppliers without a PRV code get the next ones, oldest registration first, after the highest
//    code already in use (codes used to be given only on approval).
// 2. Requests get the priority rank lists sort by, and the frequency (from opexDetails when it was
//    recorded there, otherwise "once").
// 3. Generated files (bank TXT, SIRE, reports) without a DOC number get one, oldest first.
// 4. --assign-areas: each supplier with no areas yet gets the areas of the requesters who used it
//    and of its proposer. Until then (or for a supplier nobody used) it stays shared with every
//    area. This changes what requesters see, so it is a separate, deliberate step.

const apply = process.argv.includes("--apply");
const assignAreas = process.argv.includes("--assign-areas");

const UNASSIGNED_AREAS = new Set(["", "GENERAL", "*"]);

const codeNumber = (code) => {
  const match = /^PRV-(\d+)$/.exec(String(code || ""));
  return match ? Number(match[1]) : 0;
};
const docNumber = (value) => {
  const match = /^DOC-(\d{4})-(\d+)$/.exec(String(value || ""));
  return match ? { year: Number(match[1]), sequence: Number(match[2]) } : null;
};
const area = (value) => String(value || "").trim().replace(/\s+/g, " ");

async function nextFromCounter(counters, key, year) {
  const result = await counters.findOneAndUpdate(
    { key, year },
    { $inc: { sequence: 1 }, $setOnInsert: { key, year, createdAt: new Date() }, $set: { updatedAt: new Date() } },
    { upsert: true, returnDocument: "after" }
  );
  return (result?.value || result).sequence;
}

async function raiseCounter(counters, key, year, value) {
  if (!(value > 0)) return;
  await counters.updateOne({ key, year }, { $max: { sequence: value }, $setOnInsert: { key, year, createdAt: new Date() } }, { upsert: true });
}

export async function migratePlatformImprovements(db, { apply = false, assignAreas = false } = {}) {
  const suppliers = db.collection("suppliers");
  const requests = db.collection("financialrequests");
  const generated = db.collection("generatedfiles");
  const counters = db.collection("counters");
  const users = db.collection("users");
  const report = { mode: apply ? "APPLY" : "DRY_RUN", assignAreas, suppliersNumbered: [], requestsRanked: 0, requestsWithFrequency: 0, documentsNumbered: 0, suppliersGivenAreas: [] };

  // 1. PRV codes, continuing after the highest one in use.
  const withCode = await suppliers.find({ supplierCode: { $type: "string", $ne: "" } }).project({ supplierCode: 1 }).toArray();
  const highest = Math.max(0, ...withCode.map((item) => codeNumber(item.supplierCode)));
  const missing = await suppliers.find({ $or: [{ supplierCode: { $exists: false } }, { supplierCode: null }, { supplierCode: "" }] }).sort({ createdAt: 1, _id: 1 }).project({ legalName: 1, name: 1, rucDni: 1 }).toArray();
  if (apply) await raiseCounter(counters, "supplier", 0, highest);
  let preview = highest;
  for (const supplier of missing) {
    const sequence = apply ? await nextFromCounter(counters, "supplier", 0) : (preview += 1);
    const supplierCode = `PRV-${String(sequence).padStart(4, "0")}`;
    if (apply) await suppliers.updateOne({ _id: supplier._id, $or: [{ supplierCode: { $exists: false } }, { supplierCode: null }, { supplierCode: "" }] }, { $set: { supplierCode } });
    report.suppliersNumbered.push({ supplier: String(supplier._id), rucDni: supplier.rucDni, legalName: supplier.legalName || supplier.name, supplierCode });
  }

  // 2. Payment priority (P1-P4; Alta / Media / Baja move to P2 / P3), its rank, and frequency.
  for (const [legacy, priority] of Object.entries(LEGACY_REQUEST_PRIORITY_MAP)) {
    const filter = { priority: legacy };
    report.requestsRanked += await requests.countDocuments(filter);
    if (apply) await requests.updateMany(filter, { $set: { priority, priorityRank: REQUEST_PRIORITY_RANK[priority] } });
  }
  for (const [priority, rank] of Object.entries(REQUEST_PRIORITY_RANK)) {
    const filter = { priority, priorityRank: { $ne: rank } };
    report.requestsRanked += await requests.countDocuments(filter);
    if (apply) await requests.updateMany(filter, { $set: { priorityRank: rank } });
  }
  const unranked = { $or: [{ priority: { $exists: false } }, { priority: null }], priorityRank: { $exists: false } };
  report.requestsRanked += await requests.countDocuments(unranked);
  if (apply) await requests.updateMany(unranked, { $set: { priorityRank: REQUEST_PRIORITY_RANK[DEFAULT_REQUEST_PRIORITY] } });
  const withoutFrequency = { frequency: { $exists: false } };
  report.requestsWithFrequency = await requests.countDocuments(withoutFrequency);
  if (apply) {
    await requests.updateMany({ ...withoutFrequency, "opexDetails.expenseFrequency": { $type: "string" } }, [{ $set: { frequency: "$opexDetails.expenseFrequency" } }]);
    await requests.updateMany(withoutFrequency, { $set: { frequency: "ONE_OFF" } });
  }

  // 3. DOC numbers on generated files, per Lima year, continuing after the highest in use.
  const numbered = await generated.find({ documentNumber: { $type: "string" } }).project({ documentNumber: 1 }).toArray();
  const highestByYear = new Map();
  for (const item of numbered) {
    const parsed = docNumber(item.documentNumber);
    if (parsed) highestByYear.set(parsed.year, Math.max(highestByYear.get(parsed.year) || 0, parsed.sequence));
  }
  const unnumbered = await generated.find({ $or: [{ documentNumber: { $exists: false } }, { documentNumber: null }] }).sort({ createdAt: 1, _id: 1 }).project({ createdAt: 1 }).toArray();
  report.documentsNumbered = unnumbered.length;
  if (apply) {
    for (const [year, sequence] of highestByYear) await raiseCounter(counters, "generated-document", year, sequence);
    for (const file of unnumbered) {
      const year = Number(limaDateKey(file.createdAt || file._id.getTimestamp()).slice(0, 4));
      const sequence = await nextFromCounter(counters, "generated-document", year);
      await generated.updateOne({ _id: file._id, $or: [{ documentNumber: { $exists: false } }, { documentNumber: null }] }, { $set: { documentNumber: `DOC-${year}-${String(sequence).padStart(5, "0")}` } });
    }
    await generated.createIndex({ documentNumber: 1 }, { unique: true, sparse: true });
  }

  // 4. Areas for suppliers that have none yet: who proposed it and who used it on a request.
  if (assignAreas) {
    const withoutAreas = await suppliers.find({ $or: [{ departments: { $exists: false } }, { departments: { $size: 0 } }] }).project({ proposedBy: 1, legalName: 1, name: 1, supplierCode: 1 }).toArray();
    for (const supplier of withoutAreas) {
      const used = await requests.distinct("requesterArea", { $or: [{ supplier: supplier._id }, { "quotations.supplier": supplier._id }] });
      const proposer = supplier.proposedBy ? await users.findOne({ _id: supplier.proposedBy }, { projection: { area: 1, role: 1 } }) : null;
      // Finance staff propose suppliers for everyone: their area does not restrict the supplier.
      const proposerArea = proposer && !["Admin", "Accounting", "Treasury", "Procurement", "SuperAdmin"].includes(proposer.role) ? proposer.area : "";
      const byKey = new Map();
      for (const value of [...used, proposerArea]) {
        const name = area(value);
        if (name && !UNASSIGNED_AREAS.has(name.toUpperCase())) byKey.set(name.toLocaleUpperCase("es"), name);
      }
      const departments = [...byKey.values()];
      if (!departments.length) continue;
      if (apply) await suppliers.updateOne({ _id: supplier._id, $or: [{ departments: { $exists: false } }, { departments: { $size: 0 } }] }, { $set: { departments } });
      report.suppliersGivenAreas.push({ supplier: String(supplier._id), supplierCode: supplier.supplierCode || "", legalName: supplier.legalName || supplier.name, departments });
    }
  }

  if (apply) {
    await requests.createIndex({ priorityRank: -1, createdAt: -1 });
    await suppliers.createIndex({ departments: 1, legalName: 1 });
    await db.collection("migrationruns").updateOne(
      { key: "platform-improvements-2026-10" },
      { $set: { appliedAt: new Date(), summary: { suppliersNumbered: report.suppliersNumbered.length, requestsRanked: report.requestsRanked, documentsNumbered: report.documentsNumbered, suppliersGivenAreas: report.suppliersGivenAreas.length }, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await connectDB();
    console.log(JSON.stringify(await migratePlatformImprovements(mongoose.connection.db, { apply, assignAreas }), null, 2));
  } catch (error) { console.error(error); process.exitCode = 1; }
  finally { await mongoose.disconnect(); }
}
