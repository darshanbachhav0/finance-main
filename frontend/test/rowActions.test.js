import assert from "node:assert/strict";
import fs from "node:fs";
import { splitRowActions } from "../src/utils/rowActions.js";

const noop = () => {};
// The row's next step is a visible button; the rest goes to the "More" menu, destructive last.
let result = splitRowActions([
  { label: "Delete", tone: "danger", onClick: noop },
  { label: "Quick view", onClick: noop },
  { label: "Edit", primary: true, onClick: noop },
  { label: "Hidden", hidden: true, onClick: noop },
  { label: "Deactivate", destructive: true, onClick: noop },
  { label: "Open details", onClick: noop }
]);
assert.equal(result.primary.label, "Edit");
assert.deepEqual(result.menu.map((action) => action.label), ["Quick view", "Open details", "Delete", "Deactivate"]);
assert.equal(result.menu.at(-1).tone, "danger", "destructive: true is treated as danger");

// A single real action is shown as the button, with no menu; the table's own Details doesn't count.
result = splitRowActions([{ label: "Details", utility: true, onClick: noop }, { label: "Revalidate", onClick: noop }]);
assert.equal(result.primary.label, "Revalidate");
assert.deepEqual(result.menu.map((action) => action.label), ["Details"]);
// A lone destructive action is never promoted to the visible button.
result = splitRowActions([{ label: "Cancel bank file", tone: "danger", onClick: noop }]);
assert.equal(result.primary, null);
assert.equal(result.menu.length, 1);
// Disabled actions stay visible with their reason.
result = splitRowActions([{ label: "Withdraw", primary: true, disabled: true, disabledReason: "Already approved", onClick: noop }]);
assert.equal(result.primary.disabled, true);

const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const menu = source("../src/components/RowActionMenu.jsx");
assert.match(menu, /className="row-menu-trigger"/);
assert.match(menu, /t\("More"\)/);
assert.match(menu, /row-menu-count/);
const table = source("../src/components/DataTable.jsx");
assert.match(table, /footer=\{detailRecord && rowActions \? <RowActionMenu row=\{detailRecord\} actions=\{rowActions\} variant="bar"/);
assert.match(table, /<ProcedureSteps steps=\{detailSteps\(detailRecord\)\}/);
// Pages declare their next step.
assert.match(source("../src/pages/TreasuryQueue.jsx"), /label: "Confirm payment", icon: CircleCheckBig, primary: true/);
assert.match(source("../src/pages/TreasuryQueue.jsx"), /detailSteps=\{paymentSteps\}/);
assert.match(source("../src/pages/RequestsList.jsx"), /label: "Edit request", icon: Pencil, primary: true/);
assert.match(source("../src/pages/InvoiceObservations.jsx"), /revalidateSelected/);
assert.match(source("../src/pages/EmployeeReimbursementBanking.jsx"), /label: "Verify manually", icon: BadgeCheck, primary: true/);
console.log("PASS row actions: visible next step, labelled More menu, destructive last, disabled reasons, details panel steps and actions, bulk revalidation");
