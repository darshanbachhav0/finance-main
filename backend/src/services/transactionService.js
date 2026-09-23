import mongoose from "mongoose";

let transactionsSupported;

async function detectTransactionSupport() {
  if (transactionsSupported !== undefined) return transactionsSupported;
  try {
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    transactionsSupported = Boolean(hello.setName || hello.msg === "isdbgrid");
  } catch {
    transactionsSupported = false;
  }
  return transactionsSupported;
}

function atomicWritesRequired() {
  return process.env.NODE_ENV === "production" || String(process.env.REQUIRE_ATOMIC_WRITES || "").toLowerCase() === "true";
}

export async function runFinancialOperation(work) {
  if (!(await detectTransactionSupport())) {
    if (atomicWritesRequired()) {
      throw new Error("MongoDB replica-set transactions are required in this environment; refusing a non-atomic financial write. Deploy against a replica set or set REQUIRE_ATOMIC_WRITES=false only for local/non-production use.");
    }
    return work(null);
  }
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}

export function resetTransactionSupportCache() {
  transactionsSupported = undefined;
}

