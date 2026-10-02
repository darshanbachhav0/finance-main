import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import mongoose from 'mongoose';
import { uploadRoot, generatedRoot } from '../src/services/storageService.js';
import { archiveAsset, assetKey } from '../src/services/durableAssetService.js';

// Additive migration: existing files and financial records are never changed or removed.
const apply = process.argv.includes('--apply');
async function* files(root) {
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const entry of entries) {
    if (entry.isSymbolicLink() || entry.name === 'tmp') continue;
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (entry.isFile()) yield file;
  }
}
const report = { mode: apply ? 'apply' : 'dry-run', files: 0, bytes: 0, archived: 0, errors: [] };
try {
  if (apply) {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!uri) throw Error('Configure MONGODB_URI before apply.');
    process.env.DURABLE_ASSETS = 'true';
    await mongoose.connect(uri);
  }
  for (const root of [uploadRoot, generatedRoot]) for await (const file of files(root)) {
    try {
      assetKey(file); const stat = await fs.stat(file); report.files++; report.bytes += stat.size;
      if (apply) { await archiveAsset(file); report.archived++; }
    } catch (error) { report.errors.push({ file: path.relative(root, file), reason: error.message }); }
  }
  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) process.exitCode = 1;
} catch (error) { console.error('Archive migration failed:', error.message); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
