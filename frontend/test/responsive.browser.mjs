import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { createServer } from "vite";
import { chromium } from "playwright";
const root = fileURLToPath(new URL("../", import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/responsive/", import.meta.url));
await mkdir(output, {recursive:true});
const server = await createServer({root,server:{host:"127.0.0.1",port:5198,strictPort:true},logLevel:"error"});
await server.listen();
let browser;
try {
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.route("**/api/sunat-padron/status", route=>route.fulfill({contentType:"application/json",body:JSON.stringify({data:{ready:true,fresh:true,acceptablyStale:true,manifest:{datasetDate:"2026-09-15",rows:18400000},worker:{running:true},synchronization:{phase:"READY"}}})}));
 const errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.addInitScript(()=>localStorage.setItem("erp_language","en"));
 for(const width of [390,768,1024,1440]) {
  await page.setViewportSize({width,height:1000});
  await page.goto("http://127.0.0.1:5198/test/responsive.fixture.html");
  await page.locator("tbody tr").first().waitFor();
  await page.getByText("SUNAT Padrón · Ready",{exact:true}).click();
  await page.getByText("2026-09-15",{exact:true}).waitFor();
  await page.locator(".row-details summary").click();
  await page.getByRole("button",{name:"Edit contact",exact:true}).click();
  assert.equal(await page.evaluate(()=>document.body.dataset.edited),"yes");
  const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth>innerWidth+1, regions:[...document.querySelectorAll(".table-scroll,.quotation-comparison")].filter(e=>e.scrollWidth>e.clientWidth+1).map(e=>e.className)}));
  assert.deepEqual(overflow,{document:false,regions:[]},`Overflow at ${width}: ${JSON.stringify(overflow)}`);
  if(width<=900){await page.locator('.section-links a[href="#quotes"]').click();assert.equal(await page.evaluate(()=>location.hash),"#quotes");}
  await page.locator(".compact-options > summary").click();
  await page.getByRole("combobox",{name:"Sort by",exact:true}).selectOption("reference");
  await page.screenshot({path:`${output}/${width}.png`,fullPage:true});
 }
 assert.deepEqual(errors,[]);
 console.log("Responsive tables, quotations, section navigation and secondary actions passed at 390, 768, 1024 and 1440px.");
} finally {await browser?.close();await server.close();}
