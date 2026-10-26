from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from pathlib import Path

out=Path('output/documents/UMA_Finance_Simplification_Recommendations.docx')
d=Document(); sec=d.sections[0]
sec.page_width=Inches(8.27); sec.page_height=Inches(11.69)
sec.top_margin=sec.bottom_margin=Inches(.68); sec.left_margin=sec.right_margin=Inches(.78)
for name in ['Normal','Title','Subtitle','Heading 1','Heading 2','Heading 3']:
 s=d.styles[name]; s.font.name='Calibri'; s.font.color.rgb=RGBColor(0,0,0)
s=d.styles['Normal']; s.font.size=Pt(11); s.paragraph_format.space_after=Pt(6); s.paragraph_format.line_spacing=1.06
for name,size in [('Title',25),('Heading 1',19),('Heading 2',13)]:
 s=d.styles[name]; s.font.size=Pt(size); s.paragraph_format.space_after=Pt(7); s.paragraph_format.space_before=Pt(10)
d.styles['Subtitle'].font.size=Pt(11)
sec.header.paragraphs[0].text='UMA FINANCE  |  SYSTEM SIMPLIFICATION REVIEW'
sec.header.paragraphs[0].runs[0].font.size=Pt(8)
f=sec.footer.paragraphs[0]; f.text='23 October 2026  |  Recommendations for review'; f.runs[0].font.size=Pt(8)
f.add_run(' '*8+'Page ').font.size=Pt(8)
x=OxmlElement('w:fldSimple'); x.set(qn('w:instr'),'PAGE'); f._p.append(x)
d.core_properties.title='UMA Finance Simplification Recommendations'; d.core_properties.author='UMA Finance review'

def p(text, bold=None):
 z=d.add_paragraph()
 if bold and text.startswith(bold): z.add_run(bold).bold=True; z.add_run(text[len(bold):])
 else: z.add_run(text)
 return z

def table(headers, rows, widths):
 t=d.add_table(rows=1, cols=len(headers)); t.autofit=False
 for c,w in zip(t.columns,widths): c.width=Inches(w)
 for c,v in zip(t.rows[0].cells,headers): c.text=v
 for row in rows:
  for c,v in zip(t.add_row().cells,row): c.text=v
 for i,row in enumerate(t.rows):
  for j,c in enumerate(row.cells):
   c.width=Inches(widths[j]); tcpr=c._tc.get_or_add_tcPr()
   borders=OxmlElement('w:tcBorders')
   for edge in ['top','left','bottom','right']:
    e=OxmlElement('w:'+edge); e.set(qn('w:val'),'single'); e.set(qn('w:sz'),'4'); e.set(qn('w:color'),'D9D9D9'); borders.append(e)
   tcpr.append(borders)
   margins=OxmlElement('w:tcMar')
   for edge in ['top','left','bottom','right']:
    e=OxmlElement('w:'+edge); e.set(qn('w:w'),'90'); e.set(qn('w:type'),'dxa'); margins.append(e)
   tcpr.append(margins)
   if i==0:
    shade=OxmlElement('w:shd'); shade.set(qn('w:fill'),'E7EDF2'); tcpr.append(shade)
   for para in c.paragraphs:
    para.paragraph_format.space_after=Pt(2)
    for r in para.runs: r.font.size=Pt(10); r.bold=(i==0)
  no=OxmlElement('w:cantSplit'); row._tr.get_or_add_trPr().append(no)
 repeat=OxmlElement('w:tblHeader'); t.rows[0]._tr.get_or_add_trPr().append(repeat)
 return t

def page(title, intro):
 d.add_page_break(); d.add_heading(title,1); p(intro)

def rec(n,title,meta,current,change,check):
 d.add_heading(f'{n}  {title}',2)
 z=p(meta); z.runs[0].italic=True; z.runs[0].font.size=Pt(9)
 p('Today: '+current, 'Today: ')
 p('Change: '+change, 'Change: ')
 p('Success check: '+check, 'Success check: ')

d.add_heading('UMA Finance Simplification Recommendations',0)
p('A practical review for the platform owner and Finance team',None)
p('23 October 2026')
p('Keep the financial controls, but make each person see only the information and action needed for their current task. The best next step is a focused improvement of the existing platform, rather than a full redesign.')
d.add_heading('What this review covers',1)
p('This review covers requests, invoices, suppliers, approvals, purchase orders, budget, accounting, payments, employee expenses, reports, settings and operational reliability. It is based on the local source code and maintained project documentation. It is not a live production audit, a legal review or a measured usability study. The deployed version and actual user behavior were not verified.')
d.add_heading('Keep what already works',1)
p('The system already has a four-step request form, role-based menus, plain requester statuses, saved drafts, a next-action card and a simpler employee expense form. Extend these features consistently. Do not build a second version of them. [S1–S4]')
d.add_heading('The first five changes',1)
table(['Order','Recommendation','Why it comes first'],[
('1','Reliable invoice replacement and preview','A wrong identity undermines trust in every later step.'),
('2','One clear action and owner per task','People need to know who should act next.'),
('3','Short forms with sensible defaults','Reduce repeated entry and unnecessary decisions.'),
('4','Finance queues organized by work','Make exceptions and ready items easy to separate.'),
('5','Clear draft and save feedback','Prevent lost work and accidental reuse of old files.')],[.45,2.85,3.4])
p('The detailed list contains 24 recommendations. “First” means the initial release, “Next” means after that release is stable, and “Later” means validate demand before building. Effort is relative: Small, Medium or Large; it is not a delivery estimate.')

page('Make daily work easier to navigate','Use the current role-based menu and next-action components as the foundation. Reduce competing entry points without removing permissions or records. [S2–S4]')
rec(1,'Make the home page a work list','First | Medium | Owner: Product and each department','The dashboard already has tasks, and request pages have a “Your turn” card.','Put “Needs my action”, “Waiting on others” and “Recently completed” first. Every task should show the request, amount, owner, age and one button. Move less-used charts to Reports.','A requester can identify their next task without opening several requests; each task links directly to the relevant action.')
rec(2,'Keep a small menu for each role','Next | Medium | Owner: Product','Navigation already varies by role, but Finance still has several specialist destinations.','Start with four or five main destinations per role. Put specialist tools inside their work area. For Accounting: Home, Invoice work, Payables, Reports and Settings. Keep existing URLs and access checks.','Common work is reachable within two navigation steps. A read-only user still cannot access operational actions.')
rec(3,'Make one request summary the main reference','First | Medium | Owner: Product and Finance','The request detail page contains budget, documents, invoice registers, financial records and history.','Lead with purpose, supplier, total, status, current owner and next step. Keep Documents and History close. Show accounting records and detailed budget information only where the role and task need them.','A requester can explain what is happening from the first screen; Accounting can still inspect every linked payable and journal.')
rec(4,'Use plain names consistently','First | Small | Owner: Product and Finance','Plain requester statuses exist, but labels such as “A2 Batch Invoices” and technical stage names remain elsewhere.','Use “Upload several invoices” instead of A2, “Needs correction” for a correctable problem, and “Waiting for Accounting” when that is the owner. Keep precise technical statuses in Finance details and exports.','The same action has the same name in the menu, email, task list and request page. Partial payment and unfinished expense reports remain visible.')

page('Ask for less information at the start','Keep the existing four-step form. Hide fields until they become relevant, and show where automatic values came from. [S1, S3, S5]')
rec(5,'Keep only essential fields visible','First | Medium | Owner: Product and Accounting','The request form already has defaults and optional detail sections, but still handles several very different needs.','Show purpose, supplier or employee, amount, currency, cost center, needed date and evidence first. Reveal item lines, multiple quotations and investment details only when needed. Keep all fields required by the selected process.','Five first-time users can complete a routine request without an explanation of internal workflow codes.')
rec(6,'Guide the purchase route with one question','Next | Medium | Owner: Procurement and Accounting','Users choose purchase order or direct payment; the application derives the internal track.','Ask “Does this purchase need an order?” with a short explanation and an example. Offer a suggested route only after Finance agrees on the rules. Explain any change before submission.','Users can choose confidently; the chosen route never silently bypasses approvals, budget checks or invoice validation.')
rec(7,'Default the payment destination carefully','Next | Medium | Owner: Accounting and Treasury','The requester selects a supplier bank account; the platform also checks account verification and currency.','When there is one eligible verified account in the payment currency, propose it and show the bank and last four digits. Ask the user to choose only when there are several eligible accounts. Send missing or unverified accounts to the responsible team.','The normal case needs no bank-account decision. An unverified or wrong-currency account can never become payable through the default.')
rec(8,'Make draft behavior obvious','First | Medium | Owner: Engineering and Product','Saved drafts can restore form values and attachments; this is helpful but can bring old evidence into a new attempt.','Show “Saved”, “Saving” or “Not saved” with the last successful save time. Make “Continue draft” and “Start new request” clearly different. List restored files and clear old invoice data when evidence is replaced.','Refreshing restores the correct draft. Starting new does not reuse old evidence. A save failure is visible and recoverable.')

page('Make invoices trustworthy and easy to correct','Invoice reliability should precede visual changes. The earlier investigation found a stale XML precedence path and a preview race in the local code; the historical production payload was not available. Local fixes require deployment and live verification. [S6]')
rec(9,'Show the invoice identity before continuing','First | Medium | Owner: Engineering and Accounting','The form reads XML or PDF into editable invoice details. Several services later validate the evidence.','Show the active filename, supplier RUC, customer RUC when known, invoice number, date, currency and total together. Clearly label issuer and customer. If identity is uncertain, ask for correction or readable evidence rather than guessing.','The reported example reads F001-00008545 and supplier 20603075251; customer 20550807123 is never shown as its supplier.')
rec(10,'Treat replacement as replacement','First | Medium | Owner: Engineering','An earlier XML could remain attached after a PDF selection, and the backend preferred XML. Older preview responses could also overwrite newer ones.','Complete rollout of the local fixes: replace the old receipt in the single-file form, ignore outdated previews, and reject mismatched XML/PDF pairs before duplicate checking. Allow matching pairs and preserve required supporting documents.','Test XML then PDF, PDF then XML, rapid replacement, removal during reading, and draft restoration. The payload always matches the displayed active evidence.')
rec(11,'Make duplicate messages explain the evidence','First | Medium | Owner: Engineering and Accounting','The duplicate help already shows an invoice, RUC, request and corrective steps, but a wrong active file makes that explanation misleading.','Show “Invoice you uploaded” beside “Invoice already registered”, including supplier, type, series and number. Distinguish different-file conflicts from genuine duplicates. Offer the permitted request link or a contact action.','Different suppliers do not collide. Leading zeros still identify the same invoice. The message never suggests cancelling an unrelated payable.')
rec(12,'Create one place for invoice corrections','Next | Large | Owner: Accounting','Invoice observations, request evidence and accounting work appear in separate places.','Build a unified work list using the existing records: Ready to review, Needs supplier correction, Needs Accounting and Completed. Show the exact problem and responsible person. Reuse validation results rather than asking users to re-enter them.','Each problem appears once with a clear owner. Fixing it updates the request, task list and invoice view without duplicate records.')

page('Reduce handoffs in approval and supplier work','Reduce repeated review, while preserving who is allowed to approve, verify suppliers and issue orders. [S1, S7, S8]')
rec(13,'Give approvers one decision summary','First | Medium | Owner: Product and approvers','There is an approval inbox, quick view, decision page and request detail view.','Use the same short decision summary everywhere: what is requested, why, amount, available budget, evidence and unusual conditions. Keep Approve and Send back prominent; show escalation only when available.','An approver can decide a routine request without visiting multiple views. Required checks and audit records still apply.')
rec(14,'Return specific corrections to a named owner','First | Medium | Owner: Finance and Product','Requests have observations and comments, and responsibility varies by the problem.','When sending work back, select the field or document to correct, write a short reason and identify the owner. Reopen the affected section directly. Keep the original comment and correction history together.','The recipient sees “Replace the invoice PDF” instead of a generic rejection. Finance can see exactly what changed on resubmission.')
rec(15,'Keep supplier proposal short','Next | Medium | Owner: Accounting','Inline supplier registration and a fuller supplier workspace already exist; Accounting handles verification.','Let the requester provide RUC, contact information and supporting evidence first. Reuse a supplier already registered without duplicating it or exposing another area’s restricted details. Ask for banking when it is needed for payment readiness.','A requester can propose a supplier without understanding homologation. Accounting still verifies identity and bank ownership before payment.')
rec(16,'Make order follow-up a focused work list','Next | Medium | Owner: Procurement','Orders are linked to approved requests and can receive multiple invoices; batch upload is a separate workflow.','Give Procurement views for Ready to issue, Waiting for supplier and Partly invoiced. Show order amount, invoiced amount, remaining amount and next action. Open batch upload from the selected order with context already filled.','Staff do not reselect the order or supplier unnecessarily. Remaining balances and closure rules stay consistent with the existing financial records.')

page('Simplify accounting and payments','Group screens around the work to finish. Keep approval, booking, bank verification, payment confirmation and reconciliation as separate controlled actions. [S9–S11]')
rec(17,'Show Accounting only the unresolved checks','Next | Large | Owner: Accounting and Engineering','Accounting has entries, payables, observations, periods, SIRE and evidence views.','For each invoice, summarize supplier, identity, amounts, budget, evidence and tax-check result once. Put passed checks in an expandable section; highlight missing or failed checks with a direct action. Keep journals available below.','A routine invoice needs one coherent review. A tax-service outage is not presented as a failed supplier or an automatically verified invoice.')
rec(18,'Lead with the unpaid amount','Next | Medium | Owner: Accounting and Treasury','Payables support partial payment, credits, cancellations and separate payment history.','Use invoice total, adjustments, paid amount and remaining amount as the shared money summary. Show gross amount and the amount to pay separately when deductions apply. Explain every difference through linked entries.','Users can reconcile the displayed remaining amount to payments and adjustments; the system never shows an invoice as fully paid after a partial payment.')
rec(19,'Keep the existing payment steps and simplify each','Next | Medium | Owner: Treasury','Treasury already separates preparation, confirmation, reconciliation and history; bank-file verification is another controlled stage.','Show eligible payments by currency in preparation. Show only submitted payments in confirmation and confirmed payments in reconciliation. Keep rejected payments in a clear recovery queue. Reuse one summary for account, invoice and amount.','Creating a bank file never means “Paid”. Bank rejection does not lose the original attempt. A confirmed payment cannot be paid again.')
rec(20,'Give employees one expense settlement summary','Next | Medium | Owner: Accounting and Product','The simple expense form and bank-account hold flow already exist for employee advances.','Put amount received, supported expenses, money returned, balance and deadline at the top. Give one next action: Add receipts, Correct receipts or Register bank account. Preserve the working-day deadline and recovery process.','Employees understand what remains before closure. A paid advance with outstanding receipts never looks completely finished.')

page('Make budget reports and administration quieter','Keep detail available, but separate daily decisions from configuration and technical maintenance. [S4, S12–S14]')
rec(21,'Show one budget answer before the detail','Next | Medium | Owner: Treasury and Management','Budget Control covers annual plans, monthly availability, changes and exceptions.','For requesters, lead with “Within budget” or “Budget review needed”, the applicable amount and its basis. For Treasury, separate Daily review from Plan maintenance. Keep exception decisions with Management.','A requester understands whether they can proceed. Treasury can trace available funds to the ledger, including commitments and releases.')
rec(22,'Organize reports around decisions','Later | Medium | Owner: Management and Finance','Reports already contain many charts, filters, exports and drill-down links.','Start with three saved views: What needs action, What must be paid and How the budget is being used. Keep detailed charts behind those views. Show the period, currency basis, last refresh and calculation meaning beside each total.','Two screens using the same scope show the same totals. A manager can move from an unusual number to the underlying permitted records.')
rec(23,'Use reminders only when someone can act','Next | Medium | Owner: Product and department leads','The system already has in-app tasks, email preferences, a daily digest and follow-up workers.','Keep the digest as the normal summary. Reserve immediate reminders for meaningful deadlines, returned work and failed payments. Remove resolved items from actionable lists and group repeated events for the same request.','A completed task does not keep asking for action. Every reminder has an owner, a reason and a working link to the task.')
rec(24,'Simplify maintenance behind the scenes','First for release checks then Later for consolidation | Large overall | Owner: Engineering and Admin','Invoice handling spans multiple services; menus and backend access rules have separate logic. Background workers and integrations affect whether work finishes.','Share invoice identity and evidence validation across entry points. Add release tests for the main money journeys and permission boundaries. Provide Admin with a clear health view for database, storage, workers, email and tax-service readiness.','The same invoice gives the same result in single and batch upload. A stopped worker is visible. A release cannot silently change access or mark unpaid work as paid.')

page('A practical rollout plan','Make small releases that can be checked by real users. Do not migrate financial statuses or merge roles merely to make the interface appear simpler.')
table(['Release','Scope','Ready to move on when'],[
('First','1, 3–5, 8–11, 13–14 and release checks from 24','Invoice identity is reliable; users can complete a request and find the next action.'),
('Next','2, 6–7, 12, 15–21 and 23','Each department can finish its normal work from its queue without losing controls.'),
('Later','22 and deeper technical consolidation from 24','Measured usage shows which reports and repeated implementations should be consolidated.')],[.65,2.8,3.25])
d.add_heading('Start with a small pilot',2)
p('Use one department, one approver, Procurement, Accounting and Treasury. Test a normal order, a direct payment, an invoice correction, a partial payment and an employee advance. Also test two suppliers using the same invoice number. Use test records or an isolated test environment.')
p('Before each release, record task completion, time spent, wrong-file submissions, corrections and support questions. After the release, repeat the same tasks. Suggested pilot targets are four of five first-time users finishing a standard request unaided and every displayed task having an owner and a working action. These are proposed acceptance targets, not current measured results.')
d.add_heading('Controls that must remain',2)
p('Keep server-side permissions, supplier and bank verification, invoice duplicate checks, budget authority, approval history, closed-period restrictions, payment evidence, partial-payment accounting, reconciliation and audit records. Hiding technical detail must never weaken those controls.')
p('Keep request status, payable status and employee expense settlement status separate internally. Show them simply, but do not collapse different financial facts into one editable status. Never automatically pay recurring requests just because their frequency is marked monthly.')
d.add_heading('Decisions to make before development',2)
p('Agree on the default purchase route, who may change payment destinations, which fields each department truly needs at submission, and which report totals Management uses. Observe users before removing a screen. Preserve historical records and existing links during navigation changes.')
d.add_heading('Release verification',2)
p('Deploy the invoice fix and verify it in the running application before measuring the redesigned flow. The earlier local frontend build and focused tests passed, but the full backend integration suite could not run without local MongoDB. Require that suite in the release environment, with payment, duplicate and access regressions passing.')

page('Review basis and proposed ownership','The references below identify the local implementation used for this review. They support the description of existing features; they do not prove that the production deployment has the same version. No simplification recommendations were implemented as part of this document.')
refs=[
('S1','Overall workflow and controls','README.md; docs/ARCHITECTURE.md; docs/ROLE_PERMISSIONS_GUIDE.md'),
('S2','Routes and role-based menus','frontend/src/App.jsx; frontend/src/utils/navigationAccess.js'),
('S3','Request form and request detail','frontend/src/pages/RequestCreate.jsx; frontend/src/pages/RequestDetail.jsx'),
('S4','Plain statuses and next actions','frontend/src/utils/plainStatus.js; frontend/src/utils/nextStep.js'),
('S5','Draft persistence and restoration','frontend/src/hooks/useWorkDraft.js'),
('S6','Invoice reading and registration','backend/src/services/invoicePdfService.js; xmlValidationService.js; invoiceRegistrationService.js; directInvoiceService.js; sunatVoucherService.js in the same folder'),
('S7','Approval decisions','frontend/src/pages/ApprovalInbox.jsx; frontend/src/pages/ApprovalDecision.jsx'),
('S8','Supplier and order workflows','frontend/src/pages/Suppliers.jsx; docs/ARCHITECTURE.md sections on suppliers and procurement'),
('S9','Accounting and payables','frontend/src/pages/AccountingEntries.jsx; frontend/src/pages/AccountsPayable.jsx'),
('S10','Payments and bank checks','frontend/src/pages/TreasuryQueue.jsx; frontend/src/pages/BankFileVerification.jsx'),
('S11','Employee expense settlement','frontend/src/components/rendition/SimpleRenditionForm.jsx; docs/ARCHITECTURE.md'),
('S12','Budget and management reports','frontend/src/pages/BudgetControl.jsx; frontend/src/pages/ManagementReports.jsx'),
('S13','Settings and access','frontend/src/pages/SettingsHub.jsx; frontend/src/utils/navigationAccess.js'),
('S14','Workers and service configuration','docs/OPERATIONS.md')]
for key,title,paths in refs:
 z=p(key+'  '+title); z.paragraph_format.space_after=Pt(1); z.runs[0].bold=True; z.runs[0].font.size=Pt(10)
 z=p(paths); z.paragraph_format.space_after=Pt(5); z.runs[0].font.size=Pt(9)
d.add_heading('How to use the list',2)
p('Product owns the screen and wording changes. Accounting owns invoice and accounting decisions. Treasury owns payment and budget operations. Procurement owns order follow-up. Management retains budget-exception decisions. Engineering owns consistency, tests and deployment. These are proposed delivery responsibilities, not changes to access permissions.')
out.parent.mkdir(parents=True,exist_ok=True); d.save(out); print(out.resolve())
