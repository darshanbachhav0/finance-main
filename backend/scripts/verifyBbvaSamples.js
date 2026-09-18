import fs from "node:fs/promises";
import crypto from "node:crypto";
import {bbvaSample} from "../test/bbvaFixtures.js";
import {BbvaBankFileAdapter,inspectBbvaFile} from "../src/integrations/banks/BbvaBankFileAdapter.js";
const output=new URL("../../data/reports/bbva-structure-tests/",import.meta.url);
await fs.mkdir(output,{recursive:true});
const report=[];
for(const currency of ["PEN","USD"]) {
  const {buffer,configuration,items}=await bbvaSample(currency);
  await fs.writeFile(new URL(`UNCONFIRMED-BBVA-${currency}-configuration.json`,output),JSON.stringify({
    ...configuration, active:false,
    notes:"Sample-derived values only. Treasury must verify all documented fields before activation.",
    bbva:{...configuration.bbva,confirmed:false,defaultDocumentCode:undefined,documentCodes:{}}
  },null,2));
  const generated=new BbvaBankFileAdapter(configuration).generateFile({currency,items});
  if(!generated.equals(buffer)) throw new Error(`${currency} differs from supplied example`);
  const file=`TEST-ONLY-BBVA-${currency}.txt`;
  await fs.writeFile(new URL(file,output),generated);
  report.push({file,...inspectBbvaFile(generated),identicalToReference:true,sha256:crypto.createHash("sha256").update(generated).digest("hex")});
}
await fs.writeFile(new URL("comparison.json",output),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
