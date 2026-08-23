"""
FastAPI backend for the PDF Editor prototype.

Endpoints:
  POST /api/upload            -> upload a PDF, get back the page model
  GET  /api/page-image/{doc_id}/{page_number} -> PNG render of a page
  POST /api/export/{doc_id}   -> apply edits, download the resulting PDF

Run with:  uvicorn main:app --reload
"""

from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os

import pdf_engine

app = FastAPI(title="PDF Editor Prototype API")

# Allow the local Vite dev server (default port 5173) to call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_FILE_SIZE_MB = 25


class EditOperation(BaseModel):
    type: str  # "replace_text" | "add_text" | "delete_text" | "edit_image" | "delete_image" | "draw_path" | "highlight"
    page: int
    bbox: Optional[List[float]] = None
    old_text: Optional[str] = None
    new_text: Optional[str] = None
    text: Optional[str] = None
    font_size: Optional[float] = 12
    color: Optional[str] = "#000000"
    # Image editing fields
    xref: Optional[int] = None
    old_bbox: Optional[List[float]] = None
    new_bbox: Optional[List[float]] = None
    replacement_image_base64: Optional[str] = None
    # Drawing / signature fields
    points: Optional[List[List[float]]] = None
    stroke_width: Optional[float] = 2


class ExportRequest(BaseModel):
    operations: List[EditOperation]


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    file_bytes = await file.read()
    size_mb = len(file_bytes) / (1024 * 1024)
    if size_mb > MAX_FILE_SIZE_MB:
        raise HTTPException(status_code=400, detail=f"File exceeds {MAX_FILE_SIZE_MB}MB limit.")

    try:
        doc_id = pdf_engine.save_upload(file_bytes)
        model = pdf_engine.analyze_document(doc_id)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not read PDF: {exc}")

    return model


@app.get("/api/page-image/{doc_id}/{page_number}")
def page_image(doc_id: str, page_number: int):
    path = pdf_engine.get_pdf_path(doc_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Document not found.")
    try:
        png_bytes = pdf_engine.render_page_png(doc_id, page_number)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Could not render page: {exc}")
    return Response(content=png_bytes, media_type="image/png")


@app.post("/api/export/{doc_id}")
def export_pdf(doc_id: str, req: ExportRequest):
    path = pdf_engine.get_pdf_path(doc_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Document not found.")

    ops = [op.dict() for op in req.operations]
    try:
        out_path = pdf_engine.apply_edits_and_export(doc_id, ops)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Export failed: {exc}")

    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename="edited.pdf",
    )