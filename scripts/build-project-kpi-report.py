"""Two-page management comparison using documented capabilities and test evidence."""
from pathlib import Path
from html import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from pypdf import PdfReader
import pypdfium2 as pdfium

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/pdf/UMA_Project_KPI_Comparison.pdf'
QA = ROOT / '.tmp/project-kpi-report'
OUT.parent.mkdir(parents=True, exist_ok=True)
QA.mkdir(parents=True, exist_ok=True)
for name, file in [('Arial', 'arial.ttf'), ('ArialBold', 'arialbd.ttf')]:
    pdfmetrics.registerFont(TTFont(name, f'C:/Windows/Fonts/{file}'))
pdfmetrics.registerFontFamily('Arial', normal='Arial', bold='ArialBold')
INK = colors.HexColor('#27252D')
RED = colors.HexColor('#C91545')
MUTED = colors.HexColor('#625E69')
styles = {
    'title': ParagraphStyle('title', fontName='ArialBold', fontSize=21, leading=25, textColor=colors.black, spaceAfter=9),
    'section': ParagraphStyle('section', fontName='ArialBold', fontSize=13, leading=17, spaceAfter=9, textColor=INK),
    'body': ParagraphStyle('body', fontName='Arial', fontSize=10, leading=13.5, textColor=INK, spaceAfter=10),
    'cell': ParagraphStyle('cell', fontName='Arial', fontSize=9.5, leading=12.4, textColor=INK),
    'head': ParagraphStyle('head', fontName='ArialBold', fontSize=9.5, leading=12, textColor=colors.white),
    'note': ParagraphStyle('note', fontName='Arial', fontSize=8.3, leading=11, textColor=MUTED, spaceAfter=5),
}

page1 = [
    ['Padrón lookup speed\nMeasure: local service latency.',
     'Three documented lookups took 325, 973 and 2,851 ms. Large-file searches delayed supplier entry.',
     'Indexed lookups took 5.8, 5.9 and 18.8 ms in paired development checks. External representative lookup runs separately. [1]',
     'Track local and external latency separately. Proposed local p95 target: below 100 ms after indexing; validate under load.'],
    ['Request entry effort\nMeasure: completion time and manual amount entries.',
     'Users entered several financial fields, including net, IGV, totals and reconciliation information.',
     'Six essential item fields, including a read-only total. IGV and totals update automatically and are recomputed by the server. [2]',
     'Measure median draft-to-submit time and correction rate. Target: zero manual IGV or final-total entries. Time savings are not yet measured.'],
    ['Quotation payment accuracy\nMeasure: inconsistent payment splits.',
     'Payment count and payment details were visible; users had to describe more of the payment arrangement manually.',
     'Three payment cards; synchronized slider and percentage input; automatic advance and balance amounts. Browser regression checks passed. [3]',
     'Track split errors and rejected saves. Proposed target: zero amount/percentage mismatches in valid quotations.'],
    ['Payment term consistency\nMeasure: records matching the selected quotation.',
     'Payment terms appeared in more than one entry point, creating repeated entry and possible inconsistency.',
     'Duplicate requested-term entry removed. Selected quotation terms carry into downstream purchase/payment records; historical fallback remains.',
     'Audit quotation-to-order-to-payable terms monthly. Target: 100% consistency for new records; identify legacy fallback separately.'],
    ['Budget planning coverage\nMeasure: required centers with current plans.',
     'Annual and monthly budgets were not clearly separated in the earlier requested planning process.',
     'Annual plans and monthly allocations now support availability, commitments, execution and payments. Actual adoption coverage is unmeasured.',
     'Target: 100% of centers requiring budgets have approved annual plans and monthly allocations where applicable. Review variance monthly.'],
]

page2 = [
    ['Responsive usability\nMeasure: tested layouts without page overflow.',
     'Earlier UI feedback identified clutter, inconsistent presentation and mobile usability needs; no comparable pass rate was recorded.',
     'UMA styling, clearer totals, mobile cards and optional sections. Latest recorded sweep: 115/115 checks passed across 23 routes and 5 widths. [3]',
     'Keep all tested layouts passing. Add real-user task completion and keyboard/accessibility checks; this is not accessibility certification.'],
    ['Notification coverage\nMeasure: eligible handoffs with delivered alerts.',
     'Notifications existed for some approvals. Accounting received no alert for a newly submitted reimbursement bank profile.',
     'The gap is confirmed. Shared task models and routing code have been started, but the complete notification feature is not integrated or verified.',
     'Complete recipient routing, status details, inbox, ownership, sender updates and reminders. Proposed target: 100% eligible handoffs; 95% delivered within 30 seconds.'],
    ['Approval timeliness\nMeasure: decisions within configured SLA.',
     'Approvers had routed work, but senders lacked consistent visibility of the current responsible person or team.',
     'Role/level/area routing and approval timestamps exist. Current overdue rate and end-to-end turnaround have not been measured.',
     'Display current ownership; add overdue reminders and escalation. Proposed target: at least 95% within configured SLA; report median stage time.'],
    ['Payment control compliance\nMeasure: payments supported by required evidence.',
     'Payment controls already existed; no earlier error or exception-rate dataset was supplied.',
     'Controls preserved: bank-file generation is not payment confirmation; bank operations and reconciliation are separate. Employee bank profiles require Finance review.',
     'Monitor unverified bank use, missing confirmation evidence and unreconciled items. Target: zero bypasses; review overdue reconciliation weekly.'],
    ['Access and audit coverage\nMeasure: reviewed privileged access and logged actions.',
     'Roles existed, but their detailed permissions and limitations needed clearer documentation.',
     'Eight operational profiles are documented, backed by seven stored roles. Server-side permissions, ownership checks and audit records remain in place. [4]',
     'Review privileged accounts quarterly and sample workflow audit trails monthly. Targets: 100% review completion and zero unexplained privileged actions.'],
]

def cell(text, header=False, first=False):
    parts = escape(text).split('\n')
    if first:
        parts[0] = '<b>' + parts[0] + '</b>'
    return Paragraph('<br/>'.join(parts), styles['head' if header else 'cell'])

def table(rows):
    headers = ['KPI and measure', 'Earlier process', 'Current system', 'Next improvement and target']
    data = [[cell(h, header=True) for h in headers]]
    data += [[cell(v, first=i == 0) for i, v in enumerate(row)] for row in rows]
    t = Table(data, colWidths=[96, 125, 145, 162], repeatRows=1, hAlign='LEFT')
    t.setStyle(TableStyle([
        ('BACKGROUND', (0,0), (-1,0), RED),
        ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F5F6F8')]),
        ('LINEBELOW', (0,0), (-1,0), .6, RED),
        ('LINEBELOW', (0,1), (-1,-1), .4, colors.HexColor('#DCDDE2')),
        ('VALIGN', (0,0), (-1,-1), 'TOP'),
        ('LEFTPADDING', (0,0), (-1,-1), 8), ('RIGHTPADDING', (0,0), (-1,-1), 8),
        ('TOPPADDING', (0,0), (-1,-1), 9), ('BOTTOMPADDING', (0,0), (-1,-1), 9),
    ]))
    return t

def footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Arial', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(42, 27, 'UMA Financial Platform  |  Management KPI Review  |  14 September 2026')
    canvas.drawRightString(570, 27, f'{doc.page} / 2')
    canvas.restoreState()

story = [Paragraph('UMA Financial Platform KPI Review', styles['title']),
    Paragraph('The platform reduces manual financial entry and improves usability. The main remaining priority is complete notification and responsibility tracking. This comparison separates delivered capabilities, test evidence and proposed operational targets.', styles['body']),
    Paragraph('Process efficiency and financial planning', styles['section']), table(page1), Spacer(1,10),
    Paragraph('<b>Measurement basis</b> Earlier process descriptions come from project discussions, not a historical KPI dataset. Targets are recommendations, not achieved results. p95 means 95% of observations are at or below that value.', styles['note']),
    Paragraph('<b>Evidence</b> [1] SUNAT Background Lookup, three paired local development measurements; excludes API/network and external SUNAT time. [2] Simplified Request Items implementation and calculation tests.', styles['note']),
    PageBreak(), Paragraph('Workflow visibility and control', styles['title']),
    Paragraph('Current status as of 14 September 2026. Preserve financial controls while completing the handoff experience and collecting production performance data.', styles['body']),
    table(page2), Spacer(1,10),
    Paragraph('<b>Recommended measurement plan</b> Establish a 30-day operational baseline before claiming time or error reductions. Process owners should review results monthly: Accounting for suppliers and banking; Budget for plans; Treasury for payment controls; administration for access and system performance.', styles['note']),
    Paragraph('<b>Evidence</b> [3] UMA UI/UX report, responsive results and quotation/item browser checks recorded on 11 September 2026; isolated test data. [4] Role Permissions Guide dated 10 September 2026. Notification gap verified in the current code and user report.', styles['note']),
]
doc = SimpleDocTemplate(str(OUT), pagesize=letter, rightMargin=42, leftMargin=42, topMargin=36, bottomMargin=42,
    title='UMA Financial Platform KPI Review', author='UMA Project Review', subject='Before and current comparison and recommended KPI targets')
doc.build(story, onFirstPage=footer, onLaterPages=footer)
reader = PdfReader(str(OUT))
assert len(reader.pages) == 2, f'Expected two pages, found {len(reader.pages)}'
pdf = pdfium.PdfDocument(str(OUT))
for i in range(len(pdf)):
    page = pdf[i]
    bitmap = page.render(scale=1.7)
    bitmap.to_pil().save(QA / f'page-{i+1}.png')
    bitmap.close()
    page.close()
pdf.close()
print(f'Created {OUT}\nPages: {len(reader.pages)}')
