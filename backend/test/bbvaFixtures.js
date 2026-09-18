import fs from "node:fs/promises";
import BankFormatConfiguration from "../src/models/BankFormatConfiguration.js";

// Sample-derived TEST configuration. Never installed in the operational database.
export async function bbvaSample(currency) {
  const file = currency === "PEN" ? "BBVAPROVSOLES31082026.txt" : "BBVAPROVDOLARES31082026.txt";
  const buffer = await fs.readFile(new URL(`../../data/${file}`,import.meta.url));
  const [header,...rows] = buffer.toString("latin1").split(/\r?\n/).filter(Boolean);
  const c = {
    confirmed:true, encoding:"latin1", lineEnding:"LF", finalNewline:false, truncateText:true,
    debitAccount:header.slice(3,23), headerPrefix:header.slice(0,3), headerControl:header.slice(41,51),
    headerLabel:header.slice(51,76), headerTrailer:header.slice(82), detailPrefix:"002",
    rucCode:"R", dniCode:"L", internalCode:"P", interbankCode:"I", internalAccountLength:20, internalAccountPrefix:"",
    descriptionControl:"N", contactControl:"E", detailTrailer:rows[0].slice(227),
    defaultContact:"TREASURY@EXAMPLE.INVALID", orderingContact:rows[0].slice(197,227).trim(), defaultDocumentCode:"F"
  };
  const configuration = {bank:"BBVA",currency,active:true,mode:"FIXED_WIDTH",specificationVersion:"UMA-BBVA-151-277-v1",bbva:c};
  const items = rows.map(row => ({
    supplierIdentifier:row.slice(4,16).trim(),supplierName:row.slice(37,77).trim(),currency,
    bankAccount:{bank:row[16]==="P"?"BBVA":"BCP",currency,accountNumber:row.slice(17,37),cci:row.slice(17,37)},
    amount:Number(row.slice(77,92))/100,paymentReference:row.slice(93,105).trim(),
    paymentDescription:row.slice(106,146).trim(),paymentContact:row.slice(147,197).trim(),
    accountsPayable:{voucher:{voucherType:row[92]}}
  }));
  c.documentCodes={B:"B",F:"F"};
  return {buffer,configuration,items};
}
export async function installBbvaTestConfiguration(currency="PEN") {
  const {configuration} = await bbvaSample(currency);
  return BankFormatConfiguration.create(configuration);
}
