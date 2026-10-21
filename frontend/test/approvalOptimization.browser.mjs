import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import { chromium } from "playwright";
import { mockWorkDrafts } from "./mockWorkDrafts.mjs";
import { limaToday, nextPaymentCycleDate } from "../../shared/businessCalendar.mjs";

const root = fileURLToPath(new URL("../",import.meta.url));
const output = fileURLToPath(new URL("../../.tmp/approval-optimization-ui/",import.meta.url));
await mkdir(output,{ recursive: true });
const server = await createServer({ root,configFile: `${root}/vite.config.js`,server: { host: "127.0.0.1",port: 5197,strictPort: true },logLevel: "error" });
await server.listen();
const browser = await chromium.launch({ headless: true,executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH || undefined });
const errors = []; const today = limaToday();
const user = { _id: "treasury", name: "Tesorería UMA", role: "Treasury", area: "Tesorería" };
const account = { _id: "account",bank: "BCP",currency: "PEN",accountType: "CURRENT",accountNumber: "19300000001",cci: "00219300000000000100",active: true,verificationStatus: "VERIFIED" };
const supplier = { _id: "supplier",legalName: "Proveedor UMA SAC",name: "Proveedor UMA SAC",rucDni: "20123456789" };
const rows = Array.from({ length: 12 },(_,index) => {
  const id = (index+1).toString(16).padStart(24,"0");
  return { _id: id,requestId: `request${index}`,requestNumber: `SOL-2026-${String(index+1).padStart(5,"0")}`,flowType: "B",currency: "PEN",supplier,paymentEligible: true,
    eligibleBankAccounts: [account],activeBankAccounts: [account],accountsPayable: { _id: id,flowType: "B",status: "OPEN",currency: "PEN",outstandingAmount: 100,netPayableAmount: 100,detraction: { status: "NOT_APPLICABLE",confirmedAt: new Date().toISOString() },voucher: { series: "F001",number: String(index+1) } } };
});
const summary = ids => ({ supplierCount: 1,requestCount: ids.length,payableCount: ids.length,total: ids.length*100,suppliers: [{ supplierId: "supplier",supplierName: supplier.legalName,supplierIdentifier: supplier.rucDni,bank: "BCP",currency: "PEN",accountLast4: "0001",total: ids.length*100,items: rows.filter(row => ids.includes(row._id)).map(row => ({ payableId: row._id,requestId: row.requestId,requestNumber: row.requestNumber,voucherNumber: `F001-${row.accountsPayable.voucher.number}`,amount: 100,currency: "PEN" })) }] });
let generated = null; let latestSelection = [];
let accountingConfirmed = false;
const tracking = { _id:"approval-request",requestNumber:"SOL-2026-00999",flowType:"B",requestType:"OPEX",expenseNature:"SERVICES",currency:"PEN",totalAmount:1180,totalNet:1000,totalIGV:180,issueDate:today,accountingPeriod:today.slice(0,7),supplier,
  requester:{_id:"owner",name:"Solicitante UMA"},solicitor:{_id:"owner",name:"Solicitante UMA"},requesterArea:"Laboratorios",description:"Servicio de laboratorio",lines:[],attachments:[],status:"PENDIENTE_APROBACION",approvalStage:"AREA_DIRECTOR",allowedActions:["APPROVE","OBSERVE","REJECT"],
  approvalRouteSnapshot:[{sequence:1,approvalLevel:"JEFE_1",status:"APPROVED",required:true},{sequence:2,approvalLevel:"AREA_DIRECTOR",status:"PENDING",required:true,approverUser:"treasury",approverSnapshot:{name:"Dirección UMA"}}],
  approvalHistory:[{_id:"event",action:"CHAIN_APPROVED_FORWARDED",actor:{_id:"first",name:"Jefa de Laboratorio"},createdAt:"2026-10-21T18:00:00Z",stage:"JEFE_1",statusFrom:"PENDIENTE_APROBACION",statusTo:"PENDIENTE_APROBACION"}] };
const accountingPayable = () => ({ _id:rows[0]._id,request:{_id:"approval-request",requestNumber:tracking.requestNumber,flowType:"B"},supplier,flowType:"B",currency:"PEN",originalAmount:1180,penEquivalent:1180,outstandingAmount:1180,status:"OPEN",voucher:{series:"F001",number:"999",documentDate:today},history:[],
  ...(accountingConfirmed && {accountingTreatment:{spotConfirmed:true,spotCategoryCode:"022"},detraction:{status:"PENDING",amount:142,amountPen:142,rate:12,confirmedAt:new Date().toISOString(),confirmedBy:{name:"Contadora UMA"}}}) });
const batch = { _id: "batch",batchNumber: "PAY-2026-001",fileName: "BBVA-PAY-2026-001.txt",bank: "BBVA",currency: "PEN",paymentDate: nextPaymentCycleDate(),generatedAt: new Date().toISOString(),generatedBy: user,totalAmount: 1200,status: "GENERATED",verification: { status: "PENDING" },summary: summary(rows.map(row => row._id)),items: [] };
let page;
try {
  page = await browser.newPage({ viewport: { width: 1440,height: 1000 } });
  page.on("pageerror",error => { errors.push(error.message); console.error(error.stack); }); page.setDefaultTimeout(12000);
  await page.addInitScript(user => { localStorage.setItem("erp_token","isolated-txt-ui");localStorage.setItem("erp_user",JSON.stringify(user));localStorage.setItem("erp_language","es");localStorage.setItem(`uma_tour_done_${user._id}`,"true"); },user);
  await page.route(url => url.pathname.startsWith("/api/"),async route => {
    const req=route.request(),url=new URL(req.url()),path=url.pathname.slice(4);
    let body={ data: [],pagination: { page: 1,pageSize: 10,total: 0,totalPages: 1 } };
    if(path==="/auth/me") body={user};
    else if(path==="/notifications") body={data:[],unreadCount:0};
    else if(path==="/dashboard/tasks") body={items:[],counters:{},total:0};
    else if(path==="/treasury/queue") { const size=Number(url.searchParams.get("pageSize")||10),number=Number(url.searchParams.get("page")||1);body={data:generated?[]:rows.slice((number-1)*size,number*size),pagination:{page:number,pageSize:size,total:generated?0:12,totalPages:Math.ceil(12/size)},summary:{}}; }
    else if(path==="/treasury/next-run" || path==="/treasury/advances-due") body={data:{count:0}};
    else if(path==="/operations/payments") { const payload=req.postDataJSON();latestSelection=payload.payableIds;body={data:{ready:true,issues:[],advancesOnly:false,summary:summary(payload.payableIds)}}; }
    else if(path==="/treasury/bank-file") { generated=req.postDataJSON();body={data:batch,fileName:batch.fileName,notice:"Pago pendiente de confirmación."}; }
    else if(path==="/treasury/bank-files") body={data:[batch],pagination:{page:1,pageSize:10,total:1,totalPages:1}};
    else if(path==="/requests/approval-request") body={data:tracking,related:{}};
    else if(path==="/approvals/approval-request/options") body={data:{chain:false,supplierApproval:null}};
    else if(path==="/accounting/accounts-payable") body={data:[accountingPayable()],pagination:{page:1,pageSize:10,total:1,totalPages:1},summary:{}};
    else if(path==="/treasury/spot-categories") body={data:[{code:"022",description:"Otros servicios empresariales",rate:12}]};
    else if(path.endsWith("/detraction-preview")) { const subject=req.postDataJSON().categoryCode==="022";body={data:{calculation:{status:subject?"PENDING":"NOT_APPLICABLE",amountPen:subject?142:0,rate:subject?12:0},netAmount:subject?1038:1180,bankAccountRegistered:true,bankAccountLast4:"6789"}}; }
    else if(path.endsWith("/detraction-confirm")) { assert.equal(req.postDataJSON().categoryCode,"022");accountingConfirmed=true;body={data:accountingPayable()}; }
    else if(path===`/treasury/bank-files/batch/summary`) return route.fulfill({contentType:"text/csv",body:"Lote,Proveedor,Neto\r\nPAY-2026-001,Proveedor UMA SAC,1200.00"});
    return route.fulfill({contentType:"application/json",body:JSON.stringify(body)});
  });
  await mockWorkDrafts(page);
  const origin="http://127.0.0.1:5197";
  await page.goto(`${origin}/treasury`);
  await page.getByRole("button",{name:"Seleccionar todos los elegibles del filtro",exact:true}).click();
  await page.getByRole("region",{name:"Revisar y generar"}).waitFor();
  await page.waitForFunction(() => document.querySelector('.txt-summary')?.textContent.includes('1,200') || document.querySelector('.txt-summary')?.textContent.includes('1.200'));
  assert.equal(latestSelection.length,12,"all filtered pages are selected");
  await page.getByRole("button",{name:"Página siguiente",exact:true}).first().click();
  await page.getByRole("button",{name:"SOL-2026-00012",exact:true}).waitFor();
  assert.equal(latestSelection.length,12,"paging preserves the selection");
  assert.equal(await page.getByRole("button",{name:"Generar TXT",exact:true}).count(),1);
  await page.screenshot({path:`${output}/treasury-desktop.png`,fullPage:true,animations:"disabled"});
  await page.setViewportSize({width:390,height:844});
  if (await page.locator(".mobile-nav-open").count()) await page.locator(".sidebar-mobile-close").click();
  await page.waitForFunction(() => document.getElementById("primary-navigation")?.hasAttribute("inert"));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
  await page.screenshot({path:`${output}/treasury-mobile.png`,fullPage:true,animations:"disabled"});
  await page.getByRole("button",{name:"Generar TXT",exact:true}).click();
  await page.getByText("BBVA-PAY-2026-001.txt",{exact:false}).first().waitFor();
  assert.equal(generated.payableIds.length,12);assert.ok(generated.idempotencyKey);assert.equal(generated.currency,"PEN");
  assert.equal(await page.getByRole("dialog").count(),0,"generation has no duplicate confirmation dialog");
  await page.goto(`${origin}/treasury/history`);
  await page.getByText("PAY-2026-001",{exact:true}).first().waitFor();
  // DataTable exposes the same action on desktop and on narrow record cards.
  await page.locator(".row-menu-trigger").first().click();
  await page.getByRole("menuitem",{name:"Ver resumen",exact:true}).click();
  const drawer=page.getByRole("dialog");await drawer.getByText("Proveedor UMA SAC",{exact:true}).waitFor();
  const downloaded=page.waitForEvent("download");await drawer.getByRole("button",{name:"Descargar resumen por proveedor",exact:true}).click();
  assert.match((await downloaded).suggestedFilename(),/-resumen\.csv$/);
  await drawer.getByRole("button",{name:/Cerrar/}).click();
  user.role="Solicitor";user.teamAccess=true;
  await page.setViewportSize({width:1440,height:1000});
  await page.goto(`${origin}/requests/approval-request`);
  const trackingSummary=page.getByRole("region",{name:"Seguimiento de aprobación"});
  await trackingSummary.getByText("Jefa de Laboratorio",{exact:false}).waitFor();
  assert.match(await trackingSummary.innerText(),/Dirección UMA/);
  assert.equal(await page.getByRole("button",{name:/Aprobar proveedor/}).count(),0);
  await trackingSummary.getByRole("button",{name:"Ver historial",exact:true}).click();
  await page.locator(".timeline-panel:not([hidden])").getByText("Jefa de Laboratorio",{exact:false}).waitFor();
  await page.screenshot({path:`${output}/approval-tracking.png`,fullPage:true,animations:"disabled"});
  user.role="Accounting";user.name="Contadora UMA";
  await page.goto(`${origin}/accounting/payables?record=${rows[0]._id}`);
  const payableDrawer=page.getByRole("dialog");
  await payableDrawer.getByLabel("Detracción (SPOT)").selectOption("022");
  await payableDrawer.getByText(/1,038\.00/).first().waitFor();
  await payableDrawer.getByRole("button",{name:"Confirmar detracción y neto",exact:true}).click();
  await payableDrawer.getByText(/Confirmado por Contabilidad.*Contadora UMA/).waitFor();
  assert.equal(accountingConfirmed,true);
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1));
  await page.screenshot({path:`${output}/accounting-mobile.png`,fullPage:true,animations:"disabled"});
  assert.deepEqual(errors,[]);
  console.log("PASS desktop/mobile: filtered selection across pages, supplier summary/download, single TXT action, idempotency key, real approval history and Accounting SPOT confirmation.");
} catch(error) { if(page){console.error(await page.locator("body").innerText());await page.screenshot({path:`${output}/failure.png`,fullPage:true});} console.error(errors);throw error; }
finally {await browser.close();await server.close();}
