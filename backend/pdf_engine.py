"""
Core PDF intelligence + editing engine.

Responsibilities:
- Read a PDF and build a structured "page model": text spans (with bbox,
  font, size, color), images, and page dimensions.
- Render pages to PNG images so the frontend can display them.
- Apply a list of edit operations (replace text, add text, add image, etc.)
  and export a new PDF.

This uses PyMuPDF (imported as `fitz` for compatibility, though the
`pymupdf` module name is now preferred).
"""

import os
import uuid
import base64
import pymupdf  # PyMuPDF

STORAGE_DIR = os.path.join(os.path.dirname(__file__), "storage")
os.makedirs(STORAGE_DIR, exist_ok=True)

RENDER_ZOOM = 2.0


def _color_int_to_hex(color_int):
    if color_int is None:
        return "#000000"
    r = (color_int >> 16) & 0xFF
    g = (color_int >> 8) & 0xFF
    b = color_int & 0xFF
    return "#{:02x}{:02x}{:02x}".format(r, g, b)


def _hex_to_rgb01(hex_color):
    hex_color = hex_color.lstrip("#")
    r = int(hex_color[0:2], 16) / 255
    g = int(hex_color[2:4], 16) / 255
    b = int(hex_color[4:6], 16) / 255
    return (r, g, b)


def _normalize_font_name(name):
    """Strip PDF subset prefixes (e.g. 'ABCDEF+Arial-Bold') and punctuation
    so font names from different sources can be fuzzy-matched."""
    if "+" in name:
        name = name.split("+", 1)[1]
    return "".join(ch.lower() for ch in name if ch.isalnum())


def _flags_to_base14(flags, font_name=""):
    """
    Fallback when we can't find/reuse the original embedded font: pick the
    closest built-in PDF font (Helvetica/Times/Courier family) based on the
    span's font flags and name, matching bold/italic/serif/monospace.
    """
    is_bold = bool(flags & 2**4) or "bold" in font_name.lower()
    is_italic = bool(flags & 2**1) or "italic" in font_name.lower() or "oblique" in font_name.lower()
    is_monospace = bool(flags & 2**3) or "mono" in font_name.lower() or "courier" in font_name.lower()
    is_serif = bool(flags & 2**2) or any(
        s in font_name.lower() for s in ("times", "georgia", "serif", "garamond", "cambria")
    )

    if is_monospace:
        family = "co"
    elif is_serif:
        family = "ti"
    else:
        family = "he"

    if family == "he":
        if is_bold and is_italic:
            return "hebi"
        if is_bold:
            return "hebo"
        if is_italic:
            return "heit"
        return "helv"
    elif family == "ti":
        if is_bold and is_italic:
            return "tibi"
        if is_bold:
            return "tibo"
        if is_italic:
            return "tiit"
        return "tiro"
    else:
        if is_bold and is_italic:
            return "cobi"
        if is_bold:
            return "cobo"
        if is_italic:
            return "coit"
        return "cour"


def resolve_font(doc, page, font_name, flags, font_cache):
    """
    Figure out which font to use for inserted/replacement text, aiming to
    match the original as closely as possible:

    1. If the exact embedded font used by the original text is still
       present in this PDF (common - documents reuse the same 2-3 fonts
       throughout), extract and reuse the real font file. This gives a
       pixel-perfect match, including custom/branded fonts.
    2. Otherwise, fall back to the closest built-in PDF font (Helvetica,
       Times, or Courier, with bold/italic as appropriate).

    font_cache is a dict shared across one export call, so each font is
    only extracted/embedded once even if used by many edits.
    """
    cache_key = font_name or "?"
    if cache_key in font_cache:
        return font_cache[cache_key]

    resolved_name = None
    target_normalized = _normalize_font_name(font_name) if font_name else ""

    if target_normalized:
        try:
            for f in page.get_fonts(full=True):
                xref, ext, fonttype, basefont = f[0], f[1], f[2], f[3]
                if _normalize_font_name(basefont) == target_normalized:
                    try:
                        extracted = doc.extract_font(xref)
                        buffer = extracted[3] if len(extracted) > 3 else None
                        if buffer:
                            internal_name = f"reuse_{xref}"
                            page.insert_font(fontname=internal_name, fontbuffer=buffer)
                            resolved_name = internal_name
                            break
                    except Exception:
                        pass
        except Exception:
            pass

    if not resolved_name:
        resolved_name = _flags_to_base14(flags or 0, font_name or "")

    font_cache[cache_key] = resolved_name
    return resolved_name


def extract_document_fonts(doc_id: str) -> list:
    """
    Extract all unique fonts embedded in the PDF and return their raw bytes
    as base64 so the frontend can register them as @font-face web fonts.
    This gives pixel-accurate font rendering in the browser overlay.
    Returns a list of dicts: { family, weight, style, format, base64 }
    """
    path = get_pdf_path(doc_id)
    doc = pymupdf.open(path)
    seen_xrefs = set()
    fonts_out = []

    for page in doc:
        for f in page.get_fonts(full=True):
            xref = f[0]
            if xref in seen_xrefs:
                continue
            seen_xrefs.add(xref)

            basefont = f[3] or ""
            # Strip subset prefix e.g. "ABCDEF+SourceSansPro-Bold"
            clean_name = basefont.split("+", 1)[-1] if "+" in basefont else basefont

            try:
                extracted = doc.extract_font(xref)
                # extracted = (name, ext, type, content, encoding)
                font_bytes = extracted[3] if len(extracted) > 3 else None
                if not font_bytes or len(font_bytes) < 100:
                    continue

                ext = (extracted[1] or "ttf").lower()
                # Determine MIME/format
                if ext in ("otf",):
                    fmt = "opentype"
                elif ext in ("woff",):
                    fmt = "woff"
                elif ext in ("woff2",):
                    fmt = "woff2"
                else:
                    fmt = "truetype"

                # Detect bold/italic from font name
                lower = clean_name.lower()
                weight = "700" if any(x in lower for x in ("bold", "heavy", "black", "semibold", "medium")) else "400"
                style = "italic" if any(x in lower for x in ("italic", "oblique", "slanted")) else "normal"

                # Family = strip style suffixes for the CSS family name
                family = clean_name
                for suffix in ("-Bold", "-Italic", "-BoldItalic", "-Regular", "-Light",
                               "-Medium", "-SemiBold", "-Heavy", "-Black", "-Oblique",
                               "Bold", "Italic", "Regular"):
                    family = family.replace(suffix, "")
                family = family.strip("-_ ")

                fonts_out.append({
                    "family": family or clean_name,
                    "full_name": clean_name,
                    "weight": weight,
                    "style": style,
                    "format": fmt,
                    "base64": base64.b64encode(font_bytes).decode("ascii"),
                })
            except Exception:
                continue

    doc.close()
    return fonts_out


def new_document_id():
    return uuid.uuid4().hex


def save_upload(file_bytes: bytes) -> str:
    doc_id = new_document_id()
    path = os.path.join(STORAGE_DIR, f"{doc_id}.pdf")
    with open(path, "wb") as f:
        f.write(file_bytes)
    return doc_id


def get_pdf_path(doc_id: str) -> str:
    return os.path.join(STORAGE_DIR, f"{doc_id}.pdf")


def analyze_document(doc_id: str) -> dict:
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
            if block.get("type") != 0:
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
                        "flags": span.get("flags", 0),
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
    path = get_pdf_path(doc_id)
    doc = pymupdf.open(path)
    page = doc[page_number]
    mat = pymupdf.Matrix(RENDER_ZOOM, RENDER_ZOOM)
    pix = page.get_pixmap(matrix=mat)
    png_bytes = pix.tobytes("png")
    doc.close()
    return png_bytes


def apply_edits_and_export(doc_id: str, operations: list) -> str:
    path = get_pdf_path(doc_id)
    doc = pymupdf.open(path)
    font_cache = {}

    for op in operations:
        page_number = op.get("page", 0)
        if page_number < 0 or page_number >= len(doc):
            continue
        page = doc[page_number]
        op_type = op.get("type")

        if op_type == "replace_text":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

            new_text = op.get("new_text", "")
            if new_text:
                font_size = op.get("font_size", 12)
                color = _hex_to_rgb01(op.get("color", "#000000"))
                font_name = resolve_font(
                    doc, page, op.get("font_name", ""), op.get("font_flags", 0), font_cache
                )
                insert_point = pymupdf.Point(x0, y0 + font_size)
                page.insert_text(
                    insert_point,
                    new_text,
                    fontsize=font_size,
                    color=color,
                    fontname=font_name,
                )

        elif op_type == "add_text":
            x0, y0, x1, y1 = op["bbox"]
            font_size = op.get("font_size", 12)
            color = _hex_to_rgb01(op.get("color", "#000000"))
            insert_point = pymupdf.Point(x0, y0 + font_size)
            font_name = resolve_font(
                doc, page, op.get("font_name", ""), op.get("font_flags", 0), font_cache
            )
            page.insert_text(
                insert_point,
                op.get("text", ""),
                fontsize=font_size,
                color=color,
                fontname=font_name,
            )

        elif op_type == "delete_text":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

        elif op_type == "edit_image":
            old_bbox = op["old_bbox"]
            new_bbox = op.get("new_bbox", old_bbox)
            old_rect = pymupdf.Rect(*old_bbox)
            new_rect = pymupdf.Rect(*new_bbox)
            rotate = op.get("rotate", 0)

            replacement_b64 = op.get("replacement_image_base64")
            if replacement_b64:
                img_bytes = base64.b64decode(replacement_b64)
            else:
                xref = op["xref"]
                img_info = doc.extract_image(xref)
                img_bytes = img_info["image"]

            page.add_redact_annot(old_rect, fill=(1, 1, 1))
            page.apply_redactions()
            page.insert_image(new_rect, stream=img_bytes, rotate=rotate, keep_proportion=False)

        elif op_type == "add_image":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            rotate = op.get("rotate", 0)
            img_b64 = op.get("image_base64", "")
            if img_b64:
                img_bytes = base64.b64decode(img_b64)
                page.insert_image(rect, stream=img_bytes, rotate=rotate, keep_proportion=False)

        elif op_type == "delete_image":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            page.add_redact_annot(rect, fill=(1, 1, 1))
            page.apply_redactions()

        elif op_type == "draw_path":
            points = op["points"]
            if len(points) >= 2:
                color = _hex_to_rgb01(op.get("color", "#1a1d23"))
                width = op.get("stroke_width", 2)
                shape = page.new_shape()
                shape.draw_polyline([pymupdf.Point(x, y) for x, y in points])
                shape.finish(color=color, width=width, closePath=False)
                shape.commit()

        elif op_type == "highlight":
            x0, y0, x1, y1 = op["bbox"]
            rect = pymupdf.Rect(x0, y0, x1, y1)
            annot = page.add_highlight_annot(rect)
            color = _hex_to_rgb01(op.get("color", "#ffff00"))
            annot.set_colors(stroke=color)
            annot.update()

    out_id = new_document_id()
    out_path = os.path.join(STORAGE_DIR, f"{out_id}_export.pdf")
    doc.save(out_path)
    doc.close()
    return out_path