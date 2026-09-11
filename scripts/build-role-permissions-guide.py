"""Build the printable role guide from the maintained Markdown source."""
from pathlib import Path
import re
from html import escape
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "docs/ROLE_PERMISSIONS_GUIDE.md"
OUT = ROOT / "output/pdf/UMA_Role_Permissions_Guide.pdf"
OUT.parent.mkdir(parents=True, exist_ok=True)
FONT_DIR = Path("C:/Windows/Fonts")
pdfmetrics.registerFont(TTFont("Guide", str(FONT_DIR / "arial.ttf")))
pdfmetrics.registerFont(TTFont("GuideBold", str(FONT_DIR / "arialbd.ttf")))
pdfmetrics.registerFontFamily("Guide", normal="Guide", bold="GuideBold", italic="Guide", boldItalic="GuideBold")
INK = colors.HexColor("#302D38")
MUTED = colors.HexColor("#686372")
RED = colors.HexColor("#C91545")
WIDTH = 504
styles = {
    "body": ParagraphStyle("Body", fontName="Guide", fontSize=10.5, leading=14.3, textColor=INK, spaceAfter=8),
    "title": ParagraphStyle("Title", fontName="GuideBold", fontSize=23, leading=27, textColor=colors.black, spaceAfter=14, keepWithNext=True),
    "h2": ParagraphStyle("Section", fontName="GuideBold", fontSize=18, leading=22, textColor=colors.black, spaceAfter=12, keepWithNext=True),
    "h3": ParagraphStyle("Subsection", fontName="GuideBold", fontSize=11.4, leading=15, textColor=RED, spaceBefore=8, spaceAfter=5, keepWithNext=True),
    "source": ParagraphStyle("Sources", fontName="Guide", fontSize=8.1, leading=11, textColor=MUTED, spaceBefore=3, spaceAfter=3),
    "cell": ParagraphStyle("Cell", fontName="Guide", fontSize=9.1, leading=12, textColor=INK),
    "matrix": ParagraphStyle("Matrix", fontName="Guide", fontSize=8.6, leading=11.5, textColor=INK),
    "bullet": ParagraphStyle("Bullet", fontName="Guide", fontSize=10.5, leading=14.3, textColor=INK, leftIndent=13, firstLineIndent=-10, spaceAfter=6),
}

def inline(text):
    value = escape(text)
    value = re.sub(r"\*\*(.*?)\*\*", r"<b>\1</b>", value)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    return value

def make_table(lines):
    raw = [[cell.strip() for cell in line.strip().strip("|").split("|")] for line in lines]
    raw = [row for row in raw if not all(re.fullmatch(r":?-+:?", cell) for cell in row)]
    count = len(raw[0])
    matrix = count == 9
    widths = [224] + [35] * 8 if matrix else [48, WIDTH-48] if raw[0][0] == "Source" else [244, WIDTH-244] if raw[0][0] == "Permission token" else [175, WIDTH-175] if count == 2 else [172, 108, WIDTH-280]
    style = styles["matrix" if matrix else "cell"]
    cells = [[Paragraph(("<b>" if i == 0 else "") + inline(cell) + ("</b>" if i == 0 else ""), ParagraphStyle("Header", parent=style, textColor=colors.white) if i == 0 else style) for cell in row] for i, row in enumerate(raw)]
    table = Table(cells, colWidths=widths, repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), INK),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F6F5F8")]),
        ("GRID", (0, 0), (-1, -1), 0.45, colors.HexColor("#D4CFD8")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 if matrix else 3), ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 if matrix else 3),
    ]))
    if matrix:
        for row in cells:
            for cell in row[1:]:
                cell.style = ParagraphStyle("Centered", parent=cell.style, alignment=1)
    return table

class GuideDoc(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "Section":
            key = "section-" + re.sub(r"\W+", "-", flowable.getPlainText())
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(flowable.getPlainText(), key, 0, False)

def decorate(canvas, doc):
    canvas.saveState()
    canvas.setFont("GuideBold", 8.5)
    canvas.setFillColor(RED)
    canvas.drawString(48, 765, "UMA")
    canvas.setFont("Guide", 8.5)
    canvas.setFillColor(MUTED)
    canvas.drawString(76, 765, "Finance role permissions")
    canvas.setFont("Guide", 8)
    canvas.drawString(48, 28, "Reference date 10 September 2026")
    canvas.drawRightString(564, 28, str(doc.page))
    canvas.restoreState()

lines = SOURCE.read_text(encoding="utf-8-sig").splitlines()
story = []
i = 0
while i < len(lines):
    line = lines[i].strip()
    if not line:
        i += 1
        continue
    if line == "<!-- pagebreak -->":
        story.append(PageBreak())
    elif line.startswith("|"):
        table_lines = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            table_lines.append(lines[i]); i += 1
        story.extend([make_table(table_lines), Spacer(1, 10)])
        continue
    elif line.startswith("### "):
        story.append(Paragraph(inline(line[4:]), styles["h3"]))
    elif line.startswith("## "):
        story.append(Paragraph(inline(line[3:]), styles["h2"]))
    elif line.startswith("# "):
        story.append(Paragraph(inline(line[2:]), styles["title"]))
    elif line.startswith("SOURCES "):
        story.append(Paragraph(inline("Source references " + line[8:]), styles["source"]))
    elif line.startswith("- "):
        story.append(Paragraph("&#8226; " + inline(line[2:]), styles["bullet"]))
    elif re.match(r"^\d+\. ", line):
        story.append(Paragraph(inline(line), styles["bullet"]))
    else:
        story.append(Paragraph(inline(line), styles["body"]))
    i += 1

doc = GuideDoc(str(OUT), pagesize=letter, leftMargin=48, rightMargin=48, topMargin=53, bottomMargin=47, title="UMA Finance Role Permissions Guide", author="UMA Finance Platform", subject="Default role permissions and workflow limitations", pageCompression=1)
doc.build(story, onFirstPage=decorate, onLaterPages=decorate)
reader = PdfReader(OUT)
print(f"Created {OUT} with {len(reader.pages)} pages")
for i, page in enumerate(reader.pages):
    text = page.extract_text()
    print(f"Page {i+1}: {len(text.split())} words; {text.splitlines()[4:6]}")
assert len(reader.pages) >= 16
assert "{{PERMISSION_TABLE}}" not in SOURCE.read_text(encoding="utf-8-sig")
