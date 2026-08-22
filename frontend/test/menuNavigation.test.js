import assert from "node:assert/strict";
import { getMenuNavigationIndex } from "../src/utils/menuNavigation.js";

const actions = [
  { label: "View" },
  { label: "Unavailable", disabled: true },
  { label: "Edit" },
  { label: "Delete" }
];

const tests = [];

function test(name, callback) {
  tests.push({ name, callback });
}

test("row menu navigation skips disabled actions", () => {
  assert.equal(getMenuNavigationIndex(actions, 0, "ArrowDown"), 2);
  assert.equal(getMenuNavigationIndex(actions, 2, "ArrowUp"), 0);
});

test("row menu navigation wraps at both ends", () => {
  assert.equal(getMenuNavigationIndex(actions, 3, "ArrowDown"), 0);
  assert.equal(getMenuNavigationIndex(actions, 0, "ArrowUp"), 3);
});

test("Home and End select the first and last enabled actions", () => {
  assert.equal(getMenuNavigationIndex(actions, 2, "Home"), 0);
  assert.equal(getMenuNavigationIndex(actions, 0, "End"), 3);
});

test("an entirely disabled menu has no focus target", () => {
  assert.equal(getMenuNavigationIndex([{ disabled: true }], -1, "Home"), -1);
});

for (const item of tests) {
  item.callback();
  console.log(`PASS ${item.name}`);
}

console.log(`${tests.length} frontend tests passed.`);
