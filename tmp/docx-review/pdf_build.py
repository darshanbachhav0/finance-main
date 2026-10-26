from docx import Document
from docx.oxml.ns import qn
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from xml.sax.saxutils import escape
from pathlib import Path
from docx.table import Table as DocTable
from docx.text.paragraph import Paragraph as DocParagraph
s=getSampleStyleSheet()
s.add(ParagraphStyle(name='BodyReview',fontName='Helvetica',fontSize=10.3,leading=13.2,spaceAfter=6))
s.add(ParagraphStyle(name='MetaReview',fontName='Helvetica-Oblique',fontSize=8.6,leading=11,spaceAfter=5))
s.add(ParagraphStyle(name='SourceReview',fontName='Helvetica',fontSize=8.5,leading=10.6,spaceAfter=5))
for name,size,leading in [('Title',23,27),('Heading1',18,22),('Heading2',12.5,16)]:
 s[name].fontName='Helvetica-Bold'; s[name].fontSize=size; s[name].leading=leading; s[name].textColor=colors.black; s[name].spaceBefore=9;s[name].spaceAfter=7;s[name].alignment=TA_LEFT
story=[]; d=Document('output/documents/UMA_Finance_Simplification_Recommendations.docx')
for el in d.element.body:
 if el.tag==qn('w:p'):
  p=DocParagraph(el,d)
  if el.xpath('.//w:br[@w:type="page"]'):story.append(PageBreak());continue
  if not p.text:continue
  name=p.style.name
  style=s['Title' if name=='Title' else 'Heading1' if name=='Heading 1' else 'Heading2' if name=='Heading 2' else 'BodyReview']
  if name=='Normal' and p.runs:
   if p.runs[0].italic:style=s['MetaReview']
   elif p.runs[0].font.size and p.runs[0].font.size.pt<=9:style=s['SourceReview']
  txt=''.join(('<b>'+escape(r.text)+'</b>') if r.bold else escape(r.text) for r in p.runs)
  story.append(Paragraph(txt,style))
 elif el.tag==qn('w:tbl'):
  t=DocTable(el,d); widths=[c.width/914400*72 for c in t.columns]
  data=[[Paragraph(escape("No." if c.text == "Order" else c.text),s['SourceReview']) for c in row.cells] for row in t.rows]
  obj=Table(data,colWidths=widths,repeatRows=1,hAlign='LEFT')
  obj.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E7EDF2')),('GRID',(0,0),(-1,-1),.5,colors.HexColor('#D9D9D9')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),7),('RIGHTPADDING',(0,0),(-1,-1),7),('TOPPADDING',(0,0),(-1,-1),7),('BOTTOMPADDING',(0,0),(-1,-1),7)]));story.extend([obj,Spacer(1,10)])
def footer(c,doc):
 c.setFont('Helvetica',8);c.drawString(56,813,'UMA FINANCE  |  SYSTEM SIMPLIFICATION REVIEW');c.drawString(56,30,'23 October 2026  |  Recommendations for review');c.drawRightString(539,30,f'Page {doc.page}')
out='output/documents/UMA_Finance_Simplification_Recommendations.pdf'
SimpleDocTemplate(out,pagesize=(595.28,841.89),leftMargin=56,rightMargin=56,topMargin=48,bottomMargin=48,title='UMA Finance Simplification Recommendations',author='UMA Finance review').build(story,onFirstPage=footer,onLaterPages=footer)

