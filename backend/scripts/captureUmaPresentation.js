// Render the real, read-only demo dashboards using the production frontend build.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';
process.env.NODE_ENV='production';
process.env.JWT_SECRET=crypto.randomBytes(32).toString('hex');
process.env.CLIENT_URLS='http://127.0.0.1:5398';
if(!process.env.MONGODB_URI)throw new Error('Explicit MONGODB_URI required.');
const {default:app}=await import('../src/app.js');
const {default:User}=await import('../src/models/User.js');
await mongoose.connect(process.env.MONGODB_URI,{autoIndex:false,autoCreate:false});
const server=app.listen(5398,'127.0.0.1');await new Promise(resolve=>server.on('listening',resolve));
let browser;
try {
 const user=await User.findOne({role:'Management',active:true});
 const token=jwt.sign({id:user._id},process.env.JWT_SECRET);
 const output=new URL('../../data/reports/uma-presentation/screenshots/',import.meta.url);
 await fs.mkdir(output,{recursive:true});
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')console.log('Browser:',message.text());});
 page.on('requestfailed',request=>console.log('Failed resource:',request.url(),request.failure()?.errorText));
 await page.addInitScript(({token,user})=>{localStorage.setItem('erp_token',token);localStorage.setItem('erp_user',JSON.stringify(user));localStorage.setItem('erp_language','es');},{token,user:user.toJSON()});
 for(const width of [1440,390]) for(const [route,name] of [['/','dashboard'],['/reports','management-reports'],['/requests','requests']]) {
  await page.setViewportSize({width,height:1000});
  await page.goto(`http://127.0.0.1:${server.address().port}${route}`);await page.waitForLoadState('networkidle');
  await page.locator('.content').waitFor();
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error(`Horizontal overflow: ${name} at ${width}`);
  await page.screenshot({path:new URL(`${name}${width===390?'-mobile':''}.png`,output).pathname.replace(/^\/([A-Za-z]:)/,'$1'),fullPage:true});
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS: real demo dashboard, Management Reports and Requests rendered without JavaScript errors.');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));await mongoose.disconnect();}
