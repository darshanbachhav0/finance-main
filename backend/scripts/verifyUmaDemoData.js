import "dotenv/config";
import mongoose from "mongoose";
import FinancialRequest from "../src/models/FinancialRequest.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";
import User from "../src/models/User.js";
import { connectDB } from "../src/config/db.js";
import { RETIRED_DEMO_DNIS } from "../src/services/demoAccountRemovalService.js";

// The demo staff accounts npm run seed creates (requesters, directors, the Vice Rector, Management
// and Procurement are no longer part of the demo).
const expectedAccounts = [
  ["demo.admin@uma.edu.pe", "Admin"],
  ["demo.presupuesto@uma.edu.pe", "Treasury"],
  ["demo.contabilidad@uma.edu.pe", "Accounting"],
  ["demo.tesoreria@uma.edu.pe", "Treasury"]
];

function check(condition, message) {
  if (!condition) throw new Error(message);
}

async function verifyUsers() {
  check(await User.countDocuments({ email: /@erp\.local$/i }) === 0, "Legacy @erp.local demo accounts remain.");
  for (const [email, role] of expectedAccounts) {
    const user = await User.findOne({ email });
    check(user?.active, `Missing active demo account ${email}.`);
    check(user.role === role, `${email} has role ${user?.role}; expected ${role}.`);
  }
  const retired = await User.find({ dni: { $in: RETIRED_DEMO_DNIS }, email: /^demo\./ }).select("dni").lean();
  check(!retired.length, `Retired demo accounts remain (${retired.map((user) => user.dni).join(", ")}): run npm run demo:remove-accounts -- --apply.`);
  check(!(await FinancialRequest.exists({ developmentScenarioKey: /^UMA_\d{2}_/ })), "Demo scenario requests remain: run npm run demo:remove-accounts -- --apply.");
}

async function verifyMasterData() {
  check(await Supplier.countDocuments({ homologationStatus: "PENDING_VALIDATION", active: false }) >= 1, "Pending supplier warning scenario is missing.");
  check(await SupplierBankAccount.countDocuments({ active: false }) >= 1, "Supplier bank-account history is missing.");
}

async function main() {
  await connectDB();
  await verifyUsers();
  await verifyMasterData();
  console.log(JSON.stringify({
    success: true,
    dataset: "UMA cohesive development demo",
    demoAccounts: expectedAccounts.length,
    message: "All UMA demo-data integrity checks passed."
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => mongoose.disconnect());
