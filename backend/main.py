"""
FastAPI backend for the PDF Editor prototype.

Endpoints:
  GET  /api/session             -> current anonymous session's credit status
  POST /api/create-order        -> create a Razorpay order for 1 more edit credit
  POST /api/verify-payment      -> verify a completed payment, unlock a credit
  POST /api/upload               -> upload a PDF, get back the page model
  GET  /api/page-image/{doc_id}/{page_number} -> PNG render of a page
  POST /api/export/{doc_id}     -> apply edits, download the resulting PDF
                                    (consumes 1 credit; blocked with 402 once
                                    free edits are used up - see session_store.py)

Run with:  uvicorn main:app --reload
"""

from fastapi import FastAPI, UploadFile, File, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import List, Optional
import os
import uuid

import pdf_engine
import session_store
import payment

app = FastAPI(title="PDF Editor Prototype API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

MAX_FILE_SIZE_MB = 25
SESSION_COOKIE_NAME = "pdf_editor_session"


def get_or_create_session_id(request: Request, response: Response) -> str:
    session_id = request.cookies.get(SESSION_COOKIE_NAME)
    if not session_id:
        session_id = uuid.uuid4().hex
        response.set_cookie(
            key=SESSION_COOKIE_NAME,
            value=session_id,
            max_age=60 * 60 * 24 * 365,
            httponly=True,
            samesite="lax",
        )
    return session_id


class EditOperation(BaseModel):
    type: str
    page: int
    bbox: Optional[List[float]] = None
    old_text: Optional[str] = None
    new_text: Optional[str] = None
    text: Optional[str] = None
    font_size: Optional[float] = 12
    color: Optional[str] = "#000000"
    font_name: Optional[str] = None
    font_flags: Optional[int] = 0
    xref: Optional[int] = None
    old_bbox: Optional[List[float]] = None
    new_bbox: Optional[List[float]] = None
    replacement_image_base64: Optional[str] = None
    image_base64: Optional[str] = None
    rotate: Optional[int] = 0
    points: Optional[List[List[float]]] = None
    stroke_width: Optional[float] = 2


class ExportRequest(BaseModel):
    operations: List[EditOperation]


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str
    razorpay_payment_id: str
    razorpay_signature: str


@app.get("/api/health")
def health():
    return {"status": "ok"}


@app.get("/api/session")
def get_session_status(request: Request, response: Response):
    session_id = get_or_create_session_id(request, response)
    return session_store.get_session(session_id)


@app.post("/api/create-order")
def create_order(request: Request, response: Response):
    """Creates a Razorpay order for 1 additional edit credit (₹5)."""
    session_id = get_or_create_session_id(request, response)
    status = session_store.get_session(session_id)

    try:
        order = payment.create_order(
            amount_inr=status["price_per_edit_inr"],
            receipt=f"edit_{session_id[:12]}_{uuid.uuid4().hex[:8]}",
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Could not create payment order: {exc}")

    return {
        "order_id": order["id"],
        "amount": order["amount"],
        "currency": order["currency"],
        "key_id": payment.RAZORPAY_KEY_ID,
    }


@app.post("/api/verify-payment")
def verify_payment(req: VerifyPaymentRequest, request: Request, response: Response):
    session_id = get_or_create_session_id(request, response)

    try:
        valid = payment.verify_signature(
            req.razorpay_order_id, req.razorpay_payment_id, req.razorpay_signature
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    if not valid:
        raise HTTPException(status_code=400, detail="Payment verification failed.")

    updated = session_store.add_paid_credits(session_id, 1)
    return updated


@app.post("/api/upload")
async def upload_pdf(request: Request, response: Response, file: UploadFile = File(...)):
    get_or_create_session_id(request, response)

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
def export_pdf(doc_id: str, req: ExportRequest, request: Request, response: Response):
    session_id = get_or_create_session_id(request, response)

    if not session_store.can_export(session_id):
        status = session_store.get_session(session_id)
        raise HTTPException(
            status_code=402,
            detail={
                "message": (
                    f"You've used all {status['free_edits']} free edits. "
                    f"Pay \u20b9{status['price_per_edit_inr']} to unlock 1 more export."
                ),
                "session": status,
            },
        )

    path = pdf_engine.get_pdf_path(doc_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="Document not found.")

    ops = [op.dict() for op in req.operations]
    try:
        out_path = pdf_engine.apply_edits_and_export(doc_id, ops)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Export failed: {exc}")

    session_store.record_edit_used(session_id)

    return FileResponse(
        out_path,
        media_type="application/pdf",
        filename="edited.pdf",
    )