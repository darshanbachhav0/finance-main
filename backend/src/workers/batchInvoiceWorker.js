import "dotenv/config";
import mongoose from "mongoose";
import { connectDB } from "../config/db.js";
import MassUploadBatch from "../models/MassUploadBatch.js";
import { processMassUploadBatch } from "../services/batchInvoiceService.js";

const pollMs = Math.max(1000, Number(process.env.BATCH_INVOICE_POLL_MS || 5000));
const staleMinutes = Math.max(2, Number(process.env.BATCH_INVOICE_STALE_MINUTES || 15));
const concurrency = Math.max(1, Math.min(10, Number(process.env.BATCH_INVOICE_WORKER_CONCURRENCY || 3)));
let stopping = false;
let running = false;

async function recoverStaleBatches() {
  const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
  await MassUploadBatch.updateMany(
    {
      status: "PROCESSING",
      $or: [
        { startedAt: { $lt: cutoff } },
        { startedAt: { $exists: false }, updatedAt: { $lt: cutoff } }
      ]
    },
    {
      $set: { status: "QUEUED", startedAt: null },
      $push: { processingErrors: `Recovered stale PROCESSING batch at ${new Date().toISOString()}.` }
    }
  );
}

async function tick() {
  if (stopping || running) return;
  running = true;
  try {
    await recoverStaleBatches();
    const batches = await MassUploadBatch.find({ status: "QUEUED" })
      .sort({ createdAt: 1 })
      .limit(concurrency)
      .select("_id");
    await Promise.all(batches.map(async (batch) => {
      try {
        await processMassUploadBatch(batch._id);
      } catch (error) {
        console.error("Batch worker error", batch._id, error?.stack || error?.message || error);
      }
    }));
  } finally {
    running = false;
  }
}

async function main() {
  await connectDB();
  console.log(`UMA batch invoice worker running every ${pollMs}ms (concurrency ${concurrency})`);
  await tick();
  const timer = setInterval(() => tick().catch((error) => console.error(error)), pollMs);
  const stop = async () => {
    stopping = true;
    clearInterval(timer);
    while (running) await new Promise((resolve) => setTimeout(resolve, 100));
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
