"""
Core PDF intelligence + editing engine.

Responsibilities:
- Read a PDF and build a structured "page model": text spans (with bbox,
  font, size, color), images, and page dimensions.
- Render pages to PNG images so the frontend can display them.
- Apply a list of edit operations (replace text, add text, edit image, etc.)
  and export a new PDF.

This uses PyMuPDF (imported as `pymupdf`).
"""

import os
import uuid
import base64
import pymupdf  # PyMuPDF

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

# Render pages at this zoom factor for a crisp on-screen image.
# 2.0 == roughly 144 DPI (72 DPI is the PDF default).
RENDER_ZOOM = 2.0


def _color_int_to_hex(color_int):
    """PyMuPDF gives span colors as a packed int (0xRRGGBB). Convert to '#rrggbb'."""
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8) & 0xFF
    b = color_int & 0xFF
    return "#{:02x}{:02x}{:02x}".format(r, g, b)


def _hex_to_rgb01(hex_color):
    """'#rrggbb' -> (r, g, b) floats 0..1, as PyMuPDF expects for drawing."""
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16) / 255
    g = int(hex_color[2:4], 16) / 255
    b = int(hex_color[4:6], 16) / 255
    return (r, g, b)


def new_document_id():
    return uuid.uuid4().hex


def save_upload(file_bytes: bytes) -> str:
    """Save an uploaded PDF to storage and return its document id."""
    doc_id = new_document_id()
    path = os.path.join(STORAGE_DIR, f"{doc_id}.pdf")
    with open(path, "wb") as f:
        f.write(file_bytes)
    return doc_id


def get_pdf_path(doc_id: str) -> str:
    return os.path.join(STORAGE_DIR, f"{doc_id}.pdf")


def analyze_document(doc_id: str) -> dict:
    """
    Build the structured page model for every page in the document.
    This is the "PDF Intelligence Engine" from the blueprint (section 12).
    """
    path = get_pdf_path(doc_id)
    doc = pymupdf.open(path)

    pages = []
    span_counter = 0

    for page_index in range(len(doc)):
        page = doc[page_index]
        rect = page.rect

        text_dict = page.get_text("dict")
        spans_out = []

        for block in text_dict.get("blocks", []):
            if block.get("type") != 0:  # 0 == text block, 1 == image block
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    text = span.get("text", "")
                    if not text.strip():
                        continue
                    span_counter += 1
                    span_id = f"s{span_counter}"
                    x0, y0, x1, y1 = span["bbox"]
                    spans_out.append({
                        "id": span_id,
                        "text": text,
                        "font": span.get("font", "helv"),
                        "size": round(span.get("size", 12), 2),
                        "color": _color_int_to_hex(span.get("color")),
                        "bbox": [round(x0, 2), round(y0, 2), round(x1, 2), round(y1, 2)],
                    })

        images_out = []
        for img_index, img in enumerate(page.get_images(full=True)):
            xref = img[0]
            try:
                img_rects = page.get_image_rects(xref)
            except Exception:
                img_rects = []
            for r in img_rects:
                images_out.append({
                    "id": f"img{page_index}_{xref}_{img_index}",
                    "xref": xref,
                    "bbox": [round(r.x0, 2), round(r.y0, 2), round(r.x1, 2), round(r.y1, 2)],
                })

        pages.append({
            "page_number": page_index,
            "width": round(rect.width, 2),
            "height": round(rect.height, 2),
            "render_zoom": RENDER_ZOOM,
            "text_spans": spans_out,
            "images": images_out,
        })

    doc.close()
    return {"doc_id": doc_id, "page_count": len(pages), "pages": pages}


def render_page_png(doc_id: str, page_number: int) -> bytes:
    """Render a single page to PNG bytes at RENDER_ZOOM."""
    path = get_pdf_path(doc_id)
    doc = pymupdf.open(path)
    page = doc[page_number]
    mat = pymupdf.Matrix(RENDER_ZOOM, RENDER_ZOOM)
    pix = page.get_pixmap(matrix=mat)
    png_bytes = pix.tobytes("png")
    doc.close()
    return png_bytes


def apply_edits_and_export(doc_id: str, operations: list) -> str:
    """
    Apply a list of edit operations to the document and save the result
    as a new PDF. Returns the path to the exported file.
    """
    path = get_pdf_path(doc_id)
    doc = pymupdf.open(path)

    for op in operations:
        page_number = op.get("page", 0)
        if page_number < 0 or page_number >= len(doc):
            continue
        page = doc[page_number]
        op_type = op.get("type")

        if op_type == "replace_text":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            # Cover the old text completely (true removal, not just a
            # white box left dangling underneath other content).
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

            new_text = op.get("new_text", "")
            if new_text:
                font_size = op.get("font_size", 12)
                color = _hex_to_rgb01(op.get("color", "#000000"))
                insert_point = pymupdf.Point(x0, y0 + font_size)
                page.insert_text(
                    insert_point,
                    new_text,
                    fontsize=font_size,
                    color=color,
                    fontname="helv",
                )

        elif op_type == "add_text":
            x0, y0, x1, y1 = op["bbox"]
            font_size = op.get("font_size", 12)
            color = _hex_to_rgb01(op.get("color", "#000000"))
            insert_point = pymupdf.Point(x0, y0 + font_size)
            page.insert_text(
                insert_point,
                op.get("text", ""),
                fontsize=font_size,
                color=color,
                fontname="helv",
            )

        elif op_type == "delete_text":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

        elif op_type == "edit_image":
            # Covers both "move/resize an existing image" and "replace an
            # existing image with a new one", since both need the old
            # image area cleared and a new image drawn in its place.
            old_bbox = op["old_bbox"]
            new_bbox = op.get("new_bbox", old_bbox)
            old_rect = pymupdf.Rect(*old_bbox)
            new_rect = pymupdf.Rect(*new_bbox)

            replacement_b64 = op.get("replacement_image_base64")
            if replacement_b64:
                img_bytes = base64.b64decode(replacement_b64)
            else:
                # No replacement supplied -> keep original image pixels,
                # just move/resize it.
                xref = op["xref"]
                img_info = doc.extract_image(xref)
                img_bytes = img_info["image"]

            page.add_redact_annot(old_rect, fill=(1, 1, 1))
            page.apply_redactions()
            page.insert_image(new_rect, stream=img_bytes)

        elif op_type == "delete_image":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

    out_id = new_document_id()
    out_path = os.path.join(STORAGE_DIR, f"{out_id}_export.pdf")
    doc.save(out_path)
    doc.close()
    return out_path