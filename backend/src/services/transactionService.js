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

export async function runFinancialOperation(work) {
  if (!(await detectTransactionSupport())) return work(null);
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

