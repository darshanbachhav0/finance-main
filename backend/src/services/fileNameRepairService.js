import mongoose from "mongoose";
import { looksMisdecoded, utf8FileName } from "../utils/fileName.js";

// Uploaded file names were stored as UTF-8 read as Latin-1 ("AÃ±os.png") until the upload
// middleware decoded them. Once, at server start, the names already stored on requests are
// repaired; a name that is not valid UTF-8 that way is left untouched.
const MIGRATION_KEY = "2026-10-utf8-file-names";

export async function repairStoredFileNames({ db = mongoose.connection.db } = {}) {
  const runs = db.collection("migrationruns");
  if (await runs.findOne({ key: MIGRATION_KEY })) return { applied: false, repaired: 0 };
  const requests = db.collection("financialrequests");
  let repaired = 0;
  // The server's regex engine takes the characters themselves, not \u escapes.
  const misdecoded = `[${String.fromCharCode(0xc2)}-${String.fromCharCode(0xdf)}][${String.fromCharCode(0x80)}-${String.fromCharCode(0xbf)}]`;
  const cursor = requests.find({ "attachments.originalName": { $regex: misdecoded } }, { projection: { attachments: 1 } });
  for await (const request of cursor) {
    const updates = {};
    (request.attachments || []).forEach((attachment, index) => {
      if (!looksMisdecoded(attachment.originalName)) return;
      const fixed = utf8FileName(attachment.originalName);
      if (fixed !== attachment.originalName) updates[`attachments.${index}.originalName`] = fixed;
    });
    if (Object.keys(updates).length) {
      await requests.updateOne({ _id: request._id }, { $set: updates });
      repaired += Object.keys(updates).length;
    }
  }
  const now = new Date();
  await runs.insertOne({ key: MIGRATION_KEY, appliedAt: now, summary: { repaired }, createdAt: now, updatedAt: now });
  return { applied: true, repaired };
}
