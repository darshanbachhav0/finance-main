import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../src/app.js";
import User from "../src/models/User.js";
import Supplier from "../src/models/Supplier.js";
import SupplierBankAccount from "../src/models/SupplierBankAccount.js";

test("multipart supplier proposals accept unfinished person type and independent bank currency", { timeout: 60000 }, async () => {
  const db = `erp_supplier_validation_test_${process.pid}_${Date.now()}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${db}`, { serverSelectionTimeoutMS: 5000 });
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.on("listening", resolve));
  try {
    const user = await User.create({ name: "Proposal tester", email: "proposal@test.local", passwordHash: "unused", role: "Solicitor" });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || "dev_secret_change_me");
    async function submit(ruc, fields = {}) {
      const form = new FormData();
      for (const [key, value] of Object.entries({ rucDni: ruc, legalName: "Test supplier", personType: "", currency: "PEN", proposalJustification: "Required services", ...fields })) form.append(key, value);
      const response = await fetch(`http://127.0.0.1:${server.address().port}/api/suppliers`, {
        method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form
      });
      return { status: response.status, body: await response.json() };
    }
    const withoutBank = await submit("20123456781");
    assert.equal(withoutBank.status, 201, JSON.stringify(withoutBank));
    assert.equal(withoutBank.body.data.homologationStatus, "PENDING_VALIDATION");
    assert.equal(withoutBank.body.data.active, false);
    for (const [ruc, accountCurrency] of [["20123456782", "PEN"], ["20123456783", "USD"]]) {
      const result = await submit(ruc, { bankName: "BCP", accountType: "CURRENT", bankAccount: "1234567890", cci: "12345678901234567890", accountHolderName: "Test supplier", accountCurrency });
      assert.equal(result.status, 201, JSON.stringify(result));
      const supplier = await Supplier.findOne({ rucDni: ruc });
      const bank = await SupplierBankAccount.findOne({ supplier: supplier._id });
      assert.equal(supplier.currency, "PEN");
      assert.equal(bank.currency, accountCurrency);
      assert.equal(bank.verificationStatus, "PENDING");
    }
    const invalid = await submit("20123456784", { personType: "INVALID" });
    assert.equal(invalid.status, 422);
    assert.match(invalid.body.message, /person type/);
    assert.equal(invalid.body.details[0].field, "personType");
    assert.equal(await Supplier.countDocuments({ rucDni: "20123456784" }), 0);
    const missingCci = await submit("20123456785", { bankName: "BCP", bankAccount: "1234567890", accountCurrency: "PEN" });
    assert.equal(missingCci.status, 422);
    assert.match(missingCci.body.message, /CCI/);
    assert.equal(await Supplier.countDocuments({ rucDni: "20123456785" }), 0);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (mongoose.connection.name === db) await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
