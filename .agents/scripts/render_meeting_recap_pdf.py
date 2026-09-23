from pathlib import Path

import fitz

source = Path("attached_assets/pixl-sports-team-meeting-recap.pdf")
output_dir = Path(".agents/outputs/meeting-recap-pdf")
output_dir.mkdir(parents=True, exist_ok=True)

document = fitz.open(source)
print({"pages": document.page_count, "metadata": document.metadata})
for index, page in enumerate(document):
    pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
    target = output_dir / f"page-{index + 1}.png"
    pixmap.save(target)
    print({"page": index + 1, "size": page.rect, "image": str(target)})