// UI-only fixtures: no requests reach the live platform or a finance database.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';
const root = fileURLToPath(new URL('../', import.meta.url));
const output = fileURLToPath(new URL('../../.tmp/operations-ui/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await createServer({ root, configFile: `${root}/vite.config.js`, define: { 'import.meta.env.VITE_API_URL': JSON.stringify('/api') }, server: { host: '127.0.0.1', port: 5193, strictPort: true }, logLevel: 'error' });
await server.listen();
let browser, page;
const errors = [], results = [];
let confirmations = 0;
const user = { _id: 'user', name: 'Finance reviewer', role: 'Admin', area: 'Finance' };
try {
 browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
 page = await browser.newPage();
 page.setDefaultTimeout(12000);
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => { localStorage.setItem('erp_token','test'); localStorage.setItem('erp_language','en'); });
 await page.route(url => url.pathname.startsWith('/api/'), async route => {
   const url = new URL(route.request().url()), path = url.pathname.slice(4);
   let body = { data: [] };
   if (path === '/auth/me') body = { user };
   else if (path === '/dashboard/tasks') body = { data: [], counts: {} };
   else if (path === '/notifications') body = { data: [] };
   else if (path === '/operations/queue') body = { data: [{ id: 'request', requestNumber: 'SOL-TEST', title: 'Office supplies', next: { message: 'Complete invoice and accounting checks.', owner: 'Accounting / Requester' }, issues: [{ message: 'Invoice not posted', owner: 'Accounting', path: '/requests/request' }] }], total: 1 };
   else if (path === '/operations/suppliers') body = { data: [{ id: 'supplier', name: 'Test supplier', ready: false, issues: [{ message: 'Requirements pending' }], owner: 'Accounting', path: '/suppliers' }], total: 1 };
   else if (path === '/operations/health') body = { data: { issues: [{ message: 'Requirements pending', owner: 'Admin', path: '/administration' }] } };
   else if (path === '/operations/month-end') body = { data: { ready: false, counts: { unpostedInvoices: 1 }, items: [{ message: 'Invoice not posted', owner: 'Accounting', path: '/requests/request' }] } };
   else if (path === '/operations/statements') body = { data: { id: 'statement', rows: [{ date: '2026-10-01', reference: 'OP-1', currency: 'PEN', amount: 118, candidates: [{ payableId: 'ap', requestId: 'request', requestNumber: 'SOL-TEST' }] }] } };
   else if (path === '/operations/statements/statement/confirm') { confirmations++; body = { data: {} }; }
   await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
 });
 for (const width of [1440, 768, 390]) {
   await page.setViewportSize({ width, height: 1000 });
   await page.goto('http://127.0.0.1:5193/operations');
   await page.getByRole('heading', { name: 'Work review' }).waitFor();
   for (const tab of ['Reviews','Suppliers','Closure','Month end','Statement matching','Recurring drafts','Configuration health']) {
     await page.getByRole('button',{name:tab,exact:true}).click();
     await page.getByRole('button',{name:'Refresh',exact:true}).waitFor();
     await page.waitForTimeout(100);
     const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
     assert.equal(overflow, false, `${width}px ${tab} overflow`);
     results.push({width,tab});
   }
   await page.screenshot({ path: `${output}/${width}.png`, fullPage: true });
 }
 await page.getByRole('button',{name:'Statement matching',exact:true}).click();
 await page.locator('input[type=file]').setInputFiles({ name:'bank.csv', mimeType:'text/csv', buffer:Buffer.from('date,reference,currency,amount\n2026-10-01,OP-1,PEN,118') });
 await page.getByRole('button',{name:'Confirm reconciliation',exact:true}).click();
 await page.getByRole('dialog').waitFor(); assert.equal(confirmations,0);
 await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click(); await page.getByRole('dialog').waitFor({state:'hidden'}); assert.equal(confirmations,0);
 await page.getByRole('button',{name:'Confirm reconciliation',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Confirm reconciliation',exact:true}).click();
 await page.getByRole('button',{name:'Reconciled',exact:true}).waitFor(); assert.equal(confirmations,1);
 for (const role of ['Solicitor','Accounting','Treasury','Management']) {
   user.role=role;
   await page.goto('http://127.0.0.1:5193/operations');
   await page.getByRole('heading',{name:'Work review'}).waitFor();
   assert.equal(await page.getByRole('button',{name:'Configuration health',exact:true}).count(),0);
   assert.equal(await page.getByRole('button',{name:'Statement matching',exact:true}).count(),role==='Treasury'?1:0);
   assert.equal(await page.getByRole('button',{name:'Recurring drafts',exact:true}).count(),role==='Solicitor'?1:0);
 }
 assert.deepEqual(errors,[]);
 await writeFile(`${output}/results.json`,JSON.stringify({results,errors,confirmations},null,2));
 console.log(`PASS ${results.length} responsive workspace checks, role tabs and explicit reconciliation confirmation.`);
} catch (error) { console.error(errors); console.error(await page?.locator('body').innerText()); await page?.screenshot({ path: `${output}/failure.png` }); throw error; } finally { await browser?.close(); await server.close(); }
