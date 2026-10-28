import test from "node:test";
import assert from "node:assert/strict";
import { parseStatement, candidateMatches } from "../src/services/statementCsv.js";

test("statement import preserves quoted descriptions and rejects invalid bank movements", () => {
  const [line] = parseStatement('fecha;referencia;monto;moneda;descripcion\n27/10/2026;OP-1;-100.50;PEN;"Pago; proveedor"');
  assert.equal(line.amount, -100.5);
  assert.equal(line.date.toISOString().slice(0, 10), "2026-10-27");
  assert.equal(line.description, "Pago; proveedor");
  for (const row of ["30/02/2026;OP-1;-100;PEN", "27/10/2026;;-100;PEN", "27/10/2026;OP-1;NaN;PEN", "27/10/2026;OP-1;0;PEN", "27/10/2026;OP-1;100;EUR"]) {
    assert.throws(() => parseStatement(`fecha;referencia;monto;moneda\n${row}`), /Row 2/);
  }
});

test("reconciliation suggests only outgoing payments with matching amount, currency and date", () => {
  const line = { amount: -100, currency: "PEN", date: "2026-10-27T12:00:00Z" };
  const batch = { _id: "batch-1", batchNumber: "PAY-1", totalAmount: 100, currency: "PEN", paymentDate: "2026-10-26T12:00:00Z" };
  assert.deepEqual(candidateMatches(line, [batch]), [{ id: "batch-1", number: "PAY-1" }]);
  assert.deepEqual(candidateMatches({ ...line, amount: 100 }, [batch]), []);
  assert.deepEqual(candidateMatches(line, [{ ...batch, currency: "USD" }, { ...batch, totalAmount: 101 }, { ...batch, paymentDate: "2026-10-20" }]), []);
});
