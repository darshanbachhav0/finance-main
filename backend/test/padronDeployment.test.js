import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { ensureSunatPadron, forceSyncSunatPadron, getSunatPadronStatus, lookupSunatPadronRuc } from "../src/services/sunatPadronService.js";
const zip = Buffer.from("UEsDBBQAAAAIAI9YL12bPT7OOAQAAIMyAAAXAAAAcGFkcm9uX3JlZHVjaWRvX3J1Yy50eHSd2j1uI0cUReHcq5gNGOCprp+ukKMRbAK2aGhmHMxauHhbgMF3DUc+UtLJ7eiDKNap9+8vj/frj/vbp6/3l9v1t8fr12/XL/fHy/3ty+3ldn97fP98++X1/lO7zMs/P4/X3/94f/16/XR5XF++3f68P369fr79PWJcuPD4+b+/Mec5x8zbc97M/HjODzPvz3k38/GcDzOfz/k08/WcLzM/n/PTzPdzvsWcUodhR7Az7ih3GHgUPIw8Sh6GHkUPY4+yh8FH4cPoo/Rh+FH8MP5a+WvGXyt/zfhr8XfP+Gvlrxl/rfw146+Vv2b8tfLXjL9W/prx18pfM/5a+WvG31H+DuPvKH+H8XeUv8P4O+KD1/g7yt9h/B3l7zD+jvJ3GH9H+TuMv6P8HcbfUf4O46+Xv2789fLXjb9e/rrx18tfN/56/Odn/PXy142/Xv668dfLXzf+evnrxl8vf934G+VvGH+j/A3jb5S/YfyN8jeMv1H+hvE34quH8TfK3zD+Rvkbxt8of8P4G+VvGH+z/E3jb5a/afzN8jeNv1n+pvE3y980/mb5m8bfjO++xt8sf9P4m+VvGn+z/E3jb5W/Zfyt8reMv1X+lvG3yt8y/lb5W8bfKn/L+Fvlbxl/Kw5fjL9V/pbxt8rfMv7O8ncaf2f5O42/s/ydxt9Z/k7j7yx/p/F3lr/T+DvL32n8neXvNP7OOP0z/s7ydxp/u/xt42+Xv2387fK3jb9d/rbxt8vfNv52+dvG3y5/2/jb5W8bf7v8beNvx/Gz8Mclz58FQLJ7XIRAonx8PIsXxBH0RRgk6sfHs3hBHEJfhEKigHw8ixfEMfRFOCQqyMezeEEcRF+MxCwhJoXwrxRiJGYLMTGEjCGmhpA1xOQQMoeYHkL2EBNEyCBiighZREwSIZOIaSJEE8FEESKKYKoILauckRhZBNNFiC6CCSNEGMGUEaKMYNIIkUYwbYRoI5g4QsQRTB0h6ggmjxB5BNNHiD6CCSQcGYiNxCgkmERCJBJMIyEaCSaSEJEEU0mISoLJJEQmwXQSopNgQgkRSjClhCglmFRCpBJMK6HnXQUjMWIJppYQtQSTS4hcguklRC/BBBMimGCKCVFMMMmESCaYZkI0E0w0IaIJppoQ1QSTTRh5bcZIjG6CCSdEOMGUE6KcYNIJkU4w7YRoJ5h4QsQTTD0h6gkmnxD5BNNPiH6CCShEQMEUFGbe4DISI6FgGgrRUDARhYgomIpCVBRMRiEyCqajEB0FE1KIkIIpKURJwaQUIqVgWgrRUjAxhZWXCY3EqCmYnELkFExPIXoKJqgQQQVTVIiigkkqRFLBNBWiqWCiChFVMFWFqCqYrEJkFUxX4cx7rUZihBVMWSHKCiatEGkF01aItoKJK0RcwdQVoq5g8gqRVzB9hegrmMBCBBZMYSEKCyaxsPOK9f+Q+BdQSwECFAAUAAAACACPWC9dmz0+zjgEAACDMgAAFwAAAAAAAAAAAAAAgAEAAAAAcGFkcm9uX3JlZHVjaWRvX3J1Yy50eHRQSwUGAAAAAAEAAQBFAAAAbQQAAAAA", "base64");
test("Padrón deployment: bootstrap, immutable activation, checksum skip, cached startup and failed-update recovery", async () => {
 const dir = await fs.mkdtemp(path.join(os.tmpdir(),"uma-padron-deploy-"));
 const keys=["SUNAT_PADRON_DATA_DIR","SUNAT_PADRON_MIN_ZIP_BYTES","SUNAT_PADRON_MIN_ROWS","SUNAT_PADRON_LEGACY_DIR"];
 const original=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
 const fetch=globalThis.fetch;let calls=0, broken=false;
 process.env.SUNAT_PADRON_DATA_DIR=dir;process.env.SUNAT_PADRON_MIN_ZIP_BYTES="1";process.env.SUNAT_PADRON_MIN_ROWS="1";delete process.env.SUNAT_PADRON_LEGACY_DIR;
 globalThis.fetch=async url=>{calls++; if(String(url).includes("html"))return new Response("No publication date");return new Response(broken ? Buffer.from("invalid zip") : zip,{headers:{"content-type":"application/zip"}});};
 async function age(){const pointer=JSON.parse(await fs.readFile(path.join(dir,"active.json"),"utf8"));const file=path.join(dir,pointer.directory,"manifest.json");const data=JSON.parse(await fs.readFile(file,"utf8"));data.lastCheckedAt=new Date(Date.now()-2*86400000).toISOString();await fs.writeFile(file,JSON.stringify(data));}
 try {
  await assert.rejects(lookupSunatPadronRuc("20600000001"),/being prepared/);assert.equal(calls,0,"Missing data never triggers request-time indexing");
  const [first, concurrent]=await Promise.all([ensureSunatPadron(),ensureSunatPadron()]);assert.equal(concurrent.generatedAt,first.generatedAt);assert.equal(first.rows,200);assert.ok(first.sha256);
  const initialPointer=await fs.readFile(path.join(dir,"active.json"),"utf8");
  assert.equal((await lookupSunatPadronRuc("20600000001")).found,true);
  const count=calls;await ensureSunatPadron();await getSunatPadronStatus();assert.equal(calls,count,"Fresh startup is local only");
  const same=await ensureSunatPadron({check:true});assert.equal(same.changed,false);assert.equal(await fs.readFile(path.join(dir,"active.json"),"utf8"),initialPointer,"Identical ZIP is not reindexed");
  assert.equal((await getSunatPadronStatus()).synchronization.phase,"READY");
  broken=true;const failed=await forceSyncSunatPadron();assert.ok(failed.refreshError);assert.equal(await fs.readFile(path.join(dir,"active.json"),"utf8"),initialPointer);
  assert.equal((await getSunatPadronStatus()).synchronization.phase,"FAILED");assert.equal((await lookupSunatPadronRuc("20600000001")).found,true);
  broken=false;await forceSyncSunatPadron();const finalPointer=JSON.parse(await fs.readFile(path.join(dir,"active.json"),"utf8"));assert.notEqual(finalPointer.directory,JSON.parse(initialPointer).directory);
  await fs.access(path.join(dir,JSON.parse(initialPointer).directory,"chunks","206.txt"));
  assert.equal((await lookupSunatPadronRuc("20600000199")).found,true);
 } finally {globalThis.fetch=fetch;for(const key of keys){if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];}await fs.rm(dir,{recursive:true,force:true});}
});
