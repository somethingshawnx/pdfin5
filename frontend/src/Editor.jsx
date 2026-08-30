import React, { useState, useRef, useEffect } from "react";
import { pageImageUrl, exportPdf, getSession, createOrder, verifyPayment } from "./api";

export default function Editor({ document, onStartOver, session, onSessionChange }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [editedText, setEditedText] = useState({});
  const [activeSpanId, setActiveSpanId] = useState(null);
  const [addedTexts, setAddedTexts] = useState([]);
  const [addMode, setAddMode] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [drawings, setDrawings] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [liveStroke, setLiveStroke] = useState(null);
  const [liveHighlight, setLiveHighlight] = useState(null);
  const [strokeColor, setStrokeColor] = useState("#1a1d23");
  const [imageEdits, setImageEdits] = useState({});
  const [selectedImageId, setSelectedImageId] = useState(null);
  const fileInputRefs = useRef({});
  const [photos, setPhotos] = useState([]);
  const [selectedPhotoId, setSelectedPhotoId] = useState(null);
  const photoUploadInputRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [paymentRequired, setPaymentRequired] = useState(false);
  const [payingNow, setPayingNow] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [fitScale, setFitScale] = useState(1);
  const [zoomMultiplier, setZoomMultiplier] = useState(1);
  const canvasRef = useRef(null);
  const scrollRef = useRef(null);

  const page = document.pages[pageIndex];
  const zoom = page.render_zoom;
  const imgWidth = Math.round(page.width * zoom);
  const imgHeight = Math.round(page.height * zoom);

  const displayScale = fitScale * zoomMultiplier;

  useEffect(() => {
    function computeFitScale() {
      if (!scrollRef.current) return;
      const availableWidth = scrollRef.current.clientWidth - 64;
      const scale = availableWidth > 0 ? Math.min(1, availableWidth / imgWidth) : 1;
      setFitScale(scale);
    }
    computeFitScale();
    window.addEventListener("resize", computeFitScale);
    return () => window.removeEventListener("resize", computeFitScale);
  }, [pageIndex, imgWidth]);

  useEffect(() => {
    setZoomMultiplier(1);
  }, [pageIndex]);

  function zoomIn() {
    setZoomMultiplier((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  }

  function zoomOut() {
    setZoomMultiplier((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
  }

  function resetZoom() {
    setZoomMultiplier(1);
  }

  function getImageBbox(img) {
    return imageEdits[img.id]?.bbox || img.bbox;
  }

  function startImageDrag(e, img, mode) {
    e.stopPropagation();
    e.preventDefault();
    setSelectedImageId(img.id);
    const startBbox = getImageBbox(img);
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    function onMove(ev) {
      const dxPdf = (ev.clientX - startClientX) / displayScale / zoom;
      const dyPdf = (ev.clientY - startClientY) / displayScale / zoom;
      let [x0, y0, x1, y1] = startBbox;

      if (mode === "move") {
        x0 += dxPdf; x1 += dxPdf; y0 += dyPdf; y1 += dyPdf;
      } else if (mode === "resize-se") {
        x1 += dxPdf; y1 += dyPdf;
      } else if (mode === "resize-sw") {
        x0 += dxPdf; y1 += dyPdf;
      } else if (mode === "resize-ne") {
        x1 += dxPdf; y0 += dyPdf;
      } else if (mode === "resize-nw") {
        x0 += dxPdf; y0 += dyPdf;
      }

      if (x1 - x0 < 10) {
        if (mode.includes("w")) x0 = x1 - 10; else x1 = x0 + 10;
      }
      if (y1 - y0 < 10) {
        if (mode.includes("n")) y0 = y1 - 10; else y1 = y0 + 10;
      }

      setImageEdits((prev) => ({
        ...prev,
        [img.id]: { ...(prev[img.id] || {}), bbox: [x0, y0, x1, y1] },
      }));
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function handleReplaceFile(img, file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      setImageEdits((prev) => ({
        ...prev,
        [img.id]: {
          bbox: prev[img.id]?.bbox || img.bbox,
          replacementDataUrl: dataUrl,
          replacementBase64: base64,
        },
      }));
    };
    reader.readAsDataURL(file);
  }

  function resetImageEdit(imageId) {
    setImageEdits((prev) => {
      const next = { ...prev };
      delete next[imageId];
      return next;
    });
  }

  function triggerPhotoUpload() {
    photoUploadInputRef.current?.click();
  }

  function handlePhotoFileSelected(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(",")[1];
      const img = new window.Image();
      img.onload = () => {
        const maxWidthPt = Math.min(180, page.width * 0.4);
        const w = maxWidthPt;
        const h = w * (img.naturalHeight / img.naturalWidth);
        const x0 = (page.width - w) / 2;
        const y0 = (page.height - h) / 2;
        const id = `photo_${Date.now()}`;
        setPhotos((prev) => [
          ...prev,
          { id, page: pageIndex, bbox: [x0, y0, x0 + w, y0 + h], dataUrl, base64, rotate: 0 },
        ]);
        setSelectedPhotoId(id);
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  function startPhotoDrag(e, photo, mode) {
    e.stopPropagation();
    e.preventDefault();
    setSelectedPhotoId(photo.id);
    const startBbox = photo.bbox;
    const startClientX = e.clientX;
    const startClientY = e.clientY;

    function onMove(ev) {
      const dxPdf = (ev.clientX - startClientX) / displayScale / zoom;
      const dyPdf = (ev.clientY - startClientY) / displayScale / zoom;
      let [x0, y0, x1, y1] = startBbox;

      if (mode === "move") {
        x0 += dxPdf; x1 += dxPdf; y0 += dyPdf; y1 += dyPdf;
      } else if (mode === "resize-se") {
        x1 += dxPdf; y1 += dyPdf;
      } else if (mode === "resize-sw") {
        x0 += dxPdf; y1 += dyPdf;
      } else if (mode === "resize-ne") {
        x1 += dxPdf; y0 += dyPdf;
      } else if (mode === "resize-nw") {
        x0 += dxPdf; y0 += dyPdf;
      }

      if (x1 - x0 < 15) {
        if (mode.includes("w")) x0 = x1 - 15; else x1 = x0 + 15;
      }
      if (y1 - y0 < 15) {
        if (mode.includes("n")) y0 = y1 - 15; else y1 = y0 + 15;
      }

      setPhotos((prev) =>
        prev.map((p) => (p.id === photo.id ? { ...p, bbox: [x0, y0, x1, y1] } : p))
      );
    }

    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  function rotatePhoto(id) {
    setPhotos((prev) =>
      prev.map((p) => (p.id === id ? { ...p, rotate: (p.rotate + 90) % 360 } : p))
    );
  }

  function deletePhoto(id) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
    if (selectedPhotoId === id) setSelectedPhotoId(null);
  }

  function bringPhotoToFront(id) {
    setPhotos((prev) => {
      const found = prev.find((p) => p.id === id);
      if (!found) return prev;
      return [...prev.filter((p) => p.id !== id), found];
    });
  }

  function sendPhotoToBack(id) {
    setPhotos((prev) => {
      const found = prev.find((p) => p.id === id);
      if (!found) return prev;
      return [found, ...prev.filter((p) => p.id !== id)];
    });
  }

  function toggleAddMode() {
    setAddMode((v) => !v);
    setDrawMode(false);
    setHighlightMode(false);
  }

  function toggleDrawMode() {
    setDrawMode((v) => !v);
    setAddMode(false);
    setHighlightMode(false);
  }

  function toggleHighlightMode() {
    setHighlightMode((v) => !v);
    setAddMode(false);
    setDrawMode(false);
  }

  function toPdfPoint(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale / zoom;
    const y = (e.clientY - rect.top) / displayScale / zoom;
    return [x, y];
  }

  function handleDrawLayerMouseDown(e) {
    e.stopPropagation();

    if (drawMode) {
      let points = [toPdfPoint(e)];
      setLiveStroke({ page: pageIndex, points });

      function onMove(ev) {
        points = [...points, toPdfPoint(ev)];
        setLiveStroke({ page: pageIndex, points });
      }

      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (points.length >= 2) {
          setDrawings((prev) => [
            ...prev,
            { id: `draw_${Date.now()}`, page: pageIndex, points, color: strokeColor, strokeWidth: 2.5 },
          ]);
        }
        setLiveStroke(null);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    } else if (highlightMode) {
      const [startX, startY] = toPdfPoint(e);
      setLiveHighlight({ page: pageIndex, bbox: [startX, startY, startX, startY] });

      function onMove(ev) {
        const [mx, my] = toPdfPoint(ev);
        setLiveHighlight({ page: pageIndex, bbox: [startX, startY, mx, my] });
      }

      function onUp(ev) {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const [mx, my] = toPdfPoint(ev);
        const bbox = [
          Math.min(startX, mx),
          Math.min(startY, my),
          Math.max(startX, mx),
          Math.max(startY, my),
        ];
        if (bbox[2] - bbox[0] > 3 && bbox[3] - bbox[1] > 3) {
          setHighlights((prev) => [
            ...prev,
            { id: `hl_${Date.now()}`, page: pageIndex, bbox, color: "#ffff00" },
          ]);
        }
        setLiveHighlight(null);
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    }
  }

  function undoLastDrawing() {
    setDrawings((prev) => prev.slice(0, -1));
  }

  function undoLastHighlight() {
    setHighlights((prev) => prev.slice(0, -1));
  }

  const imageEditCount = Object.keys(imageEdits).filter((id) => {
    const edit = imageEdits[id];
    const img = document.pages.flatMap((p) => p.images).find((i) => i.id === id);
    if (!img) return false;
    const bboxChanged = edit.bbox && JSON.stringify(edit.bbox) !== JSON.stringify(img.bbox);
    return bboxChanged || !!edit.replacementBase64;
  }).length;

  const editedCount =
    Object.keys(editedText).filter(
      (id) => editedText[id] !== findSpan(id)?.text
    ).length + addedTexts.length + imageEditCount + drawings.length + highlights.length + photos.length;

  function findSpan(spanId) {
    return page.text_spans.find((s) => s.id === spanId);
  }

  function handleSpanClick(span) {
    if (addMode) return;
    setActiveSpanId(span.id);
    if (!(span.id in editedText)) {
      setEditedText((prev) => ({ ...prev, [span.id]: span.text }));
    }
  }

  function handleCanvasClick(e) {
    if (!addMode) {
      setSelectedImageId(null);
      setSelectedPhotoId(null);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale / zoom;
    const y = (e.clientY - rect.top) / displayScale / zoom;
    const newBox = {
      id: `new_${Date.now()}`,
      page: pageIndex,
      bbox: [x, y, x + 150, y + 20],
      text: "",
      font_size: 12,
      color: "#000000",
    };
    setAddedTexts((prev) => [...prev, newBox]);
    setAddMode(false);
  }

  function updateAddedText(id, text) {
    setAddedTexts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, text } : t))
    );
  }

  function removeAddedText(id) {
    setAddedTexts((prev) => prev.filter((t) => t.id !== id));
  }

  function buildOperations() {
    const ops = [];

    for (const p of document.pages) {
      for (const span of p.text_spans) {
        const newText = editedText[span.id];
        if (newText !== undefined && newText !== span.text) {
          ops.push({
            type: "replace_text",
            page: p.page_number,
            bbox: span.bbox,
            old_text: span.text,
            new_text: newText,
            font_size: span.size,
            color: span.color,
            font_name: span.font,
            font_flags: span.flags,
          });
        }
      }
    }

    for (const t of addedTexts) {
      if (t.text.trim() === "") continue;
      ops.push({
        type: "add_text",
        page: t.page,
        bbox: t.bbox,
        text: t.text,
        font_size: t.font_size,
        color: t.color,
      });
    }

    for (const p of document.pages) {
      for (const img of p.images) {
        const edit = imageEdits[img.id];
        if (!edit) continue;
        const newBbox = edit.bbox || img.bbox;
        const bboxChanged = JSON.stringify(newBbox) !== JSON.stringify(img.bbox);
        if (!bboxChanged && !edit.replacementBase64) continue;
        ops.push({
          type: "edit_image",
          page: p.page_number,
          xref: img.xref,
          old_bbox: img.bbox,
          new_bbox: newBbox,
          replacement_image_base64: edit.replacementBase64 || undefined,
        });
      }
    }

    for (const d of drawings) {
      ops.push({
        type: "draw_path",
        page: d.page,
        points: d.points,
        color: d.color,
        stroke_width: d.strokeWidth,
      });
    }

    for (const h of highlights) {
      ops.push({
        type: "highlight",
        page: h.page,
        bbox: h.bbox,
        color: h.color,
      });
    }

    for (const ph of photos) {
      ops.push({
        type: "add_image",
        page: ph.page,
        bbox: ph.bbox,
        image_base64: ph.base64,
        rotate: ph.rotate,
      });
    }

    return ops;
  }

  async function handleExport() {
    setExportError("");
    setPaymentRequired(false);
    const operations = buildOperations();
    if (operations.length === 0) {
      setExportError("No edits yet — click some text or add a text box first.");
      return;
    }
    setExporting(true);
    try {
      const blob = await exportPdf(document.doc_id, operations);
      const url = URL.createObjectURL(blob);
      const a = window.document.createElement("a");
      a.href = url;
      a.download = "edited.pdf";
      a.click();
      URL.revokeObjectURL(url);
      getSession().then(onSessionChange).catch(() => { });
    } catch (err) {
      if (err.paymentRequired) {
        setPaymentRequired(true);
        if (err.session) onSessionChange?.(err.session);
      }
      setExportError(err.message || "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function handlePayment() {
    setPaymentError("");
    if (!window.Razorpay) {
      setPaymentError(
        "Payment widget didn't load - check your internet connection and that " +
        "index.html includes the Razorpay checkout script."
      );
      return;
    }
    setPayingNow(true);
    try {
      const order = await createOrder();

      const options = {
        key: order.key_id,
        amount: order.amount,
        currency: order.currency,
        order_id: order.order_id,
        name: "PDF Editor",
        description: "1 additional edit credit",
        theme: { color: "#2f6fed" },
        handler: async function (response) {
          try {
            const updated = await verifyPayment({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            });
            onSessionChange?.(updated);
            setPaymentRequired(false);
            setExportError("");
          } catch (err) {
            setPaymentError(err.message || "Payment verification failed.");
          } finally {
            setPayingNow(false);
          }
        },
        modal: {
          ondismiss: function () {
            setPayingNow(false);
          },
        },
      };

      const rzp = new window.Razorpay(options);
      rzp.on("payment.failed", function () {
        setPaymentError("Payment failed. No credit was charged - you can try again.");
        setPayingNow(false);
      });
      rzp.open();
    } catch (err) {
      setPaymentError(err.message || "Could not start payment.");
      setPayingNow(false);
    }
  }

  return (
    <div className="editor-screen">
      <div className="toolbar">
        <button className="ghost-btn" onClick={onStartOver}>
          ← New file
        </button>

        <div className="toolbar-group">
          <button
            className={addMode ? "tool-btn active" : "tool-btn"}
            onClick={toggleAddMode}
          >
            + Add Text
          </button>
          <button
            className={drawMode ? "tool-btn active" : "tool-btn"}
            onClick={toggleDrawMode}
          >
            ✎ Draw
          </button>
          <button
            className={highlightMode ? "tool-btn active" : "tool-btn"}
            onClick={toggleHighlightMode}
          >
            ▤ Highlight
          </button>
          <button className="tool-btn" onClick={triggerPhotoUpload} title="Add a photo or an image of your signature">
            🖼 Add Photo
          </button>
          <input
            ref={photoUploadInputRef}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              handlePhotoFileSelected(e.target.files[0]);
              e.target.value = "";
            }}
          />
          {drawMode && (
            <>
              {["#1a1d23", "#dc2626", "#2f6fed", "#16a34a"].map((c) => (
                <button
                  key={c}
                  className={strokeColor === c ? "color-swatch active" : "color-swatch"}
                  style={{ background: c }}
                  onClick={() => setStrokeColor(c)}
                  title="Pen color"
                />
              ))}
              <button className="ghost-btn small" onClick={undoLastDrawing} title="Undo last stroke">
                Undo
              </button>
            </>
          )}
          {highlightMode && (
            <button className="ghost-btn small" onClick={undoLastHighlight} title="Undo last highlight">
              Undo
            </button>
          )}
        </div>

        <div className="toolbar-group page-nav">
          <button
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          >
            ‹ Prev
          </button>
          <span>
            Page {pageIndex + 1} / {document.page_count}
          </span>
          <button
            disabled={pageIndex === document.page_count - 1}
            onClick={() =>
              setPageIndex((i) => Math.min(document.page_count - 1, i + 1))
            }
          >
            Next ›
          </button>
        </div>

        <div className="toolbar-group">
          <button className="zoom-btn" onClick={zoomOut} title="Zoom out">
            −
          </button>
          <button className="zoom-pct" onClick={resetZoom} title="Reset to fit width">
            {Math.round(displayScale * 100)}%
          </button>
          <button className="zoom-btn" onClick={zoomIn} title="Zoom in">
            +
          </button>
        </div>

        <div className="toolbar-group">
          <span className={session?.requires_payment ? "edit-count warning" : "edit-count"}>
            {session
              ? session.requires_payment
                ? `0 free edits left`
                : `${session.free_edits_remaining} free edit(s) left`
              : ""}
          </span>
          <span className="edit-count">{editedCount} change(s) pending</span>
          <button className="primary-btn" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "Download PDF"}
          </button>
        </div>
      </div>

      {exportError && !paymentRequired && <div className="error-banner">{exportError}</div>}
      {paymentRequired && (
        <div className="paywall-banner">
          <div>
            <strong>Free edits used up.</strong> {exportError}
          </div>
          <button className="pay-btn" onClick={handlePayment} disabled={payingNow}>
            {payingNow ? "Opening payment…" : `Pay ₹${session?.price_per_edit_inr || 5} & Continue`}
          </button>
          {paymentError && <div className="payment-error">{paymentError}</div>}
        </div>
      )}
      {addMode && (
        <div className="hint-banner">Click anywhere on the page to place new text.</div>
      )}
      {drawMode && (
        <div className="hint-banner">Click and drag to draw — useful for a signature too.</div>
      )}
      {highlightMode && (
        <div className="hint-banner">Click and drag over text to highlight it.</div>
      )}

      <div className="canvas-scroll" ref={scrollRef}>
        <div
          className="page-canvas-wrapper"
          style={{ width: imgWidth * displayScale, height: imgHeight * displayScale }}
        >
          <div
            className="page-canvas"
            ref={canvasRef}
            style={{
              width: imgWidth,
              height: imgHeight,
              transform: `scale(${displayScale})`,
              transformOrigin: "top left",
              cursor: addMode ? "crosshair" : drawMode || highlightMode ? "crosshair" : "default",
            }}
            onClick={handleCanvasClick}
          >
            <img
              src={pageImageUrl(document.doc_id, pageIndex)}
              width={imgWidth}
              height={imgHeight}
              alt={`Page ${pageIndex + 1}`}
              draggable={false}
            />

            {page.text_spans.map((span) => {
              const [x0, y0, x1, y1] = span.bbox;
              const style = {
                left: x0 * zoom,
                top: y0 * zoom,
                width: (x1 - x0) * zoom,
                height: (y1 - y0) * zoom,
                fontSize: span.size * zoom * 0.75,
                color: span.color,
              };
              const isEdited =
                editedText[span.id] !== undefined && editedText[span.id] !== span.text;

              if (activeSpanId === span.id) {
                return (
                  <textarea
                    key={span.id}
                    className="span-editor active"
                    style={style}
                    autoFocus
                    value={editedText[span.id] ?? span.text}
                    onChange={(e) =>
                      setEditedText((prev) => ({ ...prev, [span.id]: e.target.value }))
                    }
                    onBlur={() => setActiveSpanId(null)}
                  />
                );
              }

              return (
                <div
                  key={span.id}
                  className={isEdited ? "span-box edited" : "span-box"}
                  style={
                    isEdited
                      ? { ...style, width: "max-content", minWidth: style.width }
                      : style
                  }
                  title="Click to edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSpanClick(span);
                  }}
                >
                  {isEdited ? editedText[span.id] : ""}
                </div>
              );
            })}

            {addedTexts
              .filter((t) => t.page === pageIndex)
              .map((t) => {
                const [x0, y0, x1, y1] = t.bbox;
                const style = {
                  left: x0 * zoom,
                  top: y0 * zoom,
                  width: (x1 - x0) * zoom,
                  height: (y1 - y0) * zoom,
                  fontSize: t.font_size * zoom * 0.75,
                  color: t.color,
                };
                return (
                  <div key={t.id} className="added-text-wrap" style={style}>
                    <input
                      className="span-editor added"
                      value={t.text}
                      placeholder="Type text…"
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => updateAddedText(t.id, e.target.value)}
                    />
                    <button
                      className="remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeAddedText(t.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                );
              })}

            {page.images.map((img) => {
              const [x0, y0, x1, y1] = getImageBbox(img);
              const edit = imageEdits[img.id];
              const isSelected = selectedImageId === img.id;
              const style = {
                left: x0 * zoom,
                top: y0 * zoom,
                width: (x1 - x0) * zoom,
                height: (y1 - y0) * zoom,
              };

              return (
                <div
                  key={img.id}
                  className={isSelected ? "image-box selected" : "image-box"}
                  style={style}
                  onMouseDown={(e) => startImageDrag(e, img, "move")}
                  onClick={(e) => e.stopPropagation()}
                >
                  {edit?.replacementDataUrl && (
                    <img
                      className="image-preview"
                      src={edit.replacementDataUrl}
                      alt="Replacement"
                      draggable={false}
                    />
                  )}

                  <input
                    ref={(el) => (fileInputRefs.current[img.id] = el)}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => handleReplaceFile(img, e.target.files[0])}
                  />

                  {isSelected && (
                    <>
                      <div className="image-toolbar">
                        <button
                          className="image-action-btn"
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            fileInputRefs.current[img.id]?.click();
                          }}
                        >
                          Replace
                        </button>
                        {edit && (
                          <button
                            className="image-action-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              resetImageEdit(img.id);
                            }}
                          >
                            Reset
                          </button>
                        )}
                      </div>

                      {["nw", "ne", "sw", "se"].map((corner) => (
                        <div
                          key={corner}
                          className={`resize-handle handle-${corner}`}
                          onMouseDown={(e) => startImageDrag(e, img, `resize-${corner}`)}
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}

            {photos
              .filter((ph) => ph.page === pageIndex)
              .map((ph) => {
                const [x0, y0, x1, y1] = ph.bbox;
                const isSelected = selectedPhotoId === ph.id;
                const style = {
                  left: x0 * zoom,
                  top: y0 * zoom,
                  width: (x1 - x0) * zoom,
                  height: (y1 - y0) * zoom,
                };
                const cssAngle = (360 - ph.rotate) % 360;

                return (
                  <div
                    key={ph.id}
                    className={isSelected ? "image-box selected" : "image-box"}
                    style={style}
                    onMouseDown={(e) => startPhotoDrag(e, ph, "move")}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <img
                      className="image-preview"
                      src={ph.dataUrl}
                      alt="Added photo"
                      draggable={false}
                      style={{ transform: `rotate(${cssAngle}deg)` }}
                    />

                    {isSelected && (
                      <>
                        <div className="image-toolbar">
                          <button
                            className="image-action-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              rotatePhoto(ph.id);
                            }}
                          >
                            ⟳ Rotate
                          </button>
                          <button
                            className="image-action-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              bringPhotoToFront(ph.id);
                            }}
                          >
                            Front
                          </button>
                          <button
                            className="image-action-btn"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              sendPhotoToBack(ph.id);
                            }}
                          >
                            Back
                          </button>
                          <button
                            className="image-action-btn danger"
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              deletePhoto(ph.id);
                            }}
                          >
                            Delete
                          </button>
                        </div>

                        {["nw", "ne", "sw", "se"].map((corner) => (
                          <div
                            key={corner}
                            className={`resize-handle handle-${corner}`}
                            onMouseDown={(e) => startPhotoDrag(e, ph, `resize-${corner}`)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                );
              })}

            <svg
              className="draw-layer"
              width={imgWidth}
              height={imgHeight}
              viewBox={`0 0 ${page.width} ${page.height}`}
              style={{ pointerEvents: drawMode || highlightMode ? "auto" : "none" }}
              onMouseDown={handleDrawLayerMouseDown}
              onClick={(e) => e.stopPropagation()}
            >
              {highlights
                .filter((h) => h.page === pageIndex)
                .map((h) => (
                  <rect
                    key={h.id}
                    x={h.bbox[0]}
                    y={h.bbox[1]}
                    width={h.bbox[2] - h.bbox[0]}
                    height={h.bbox[3] - h.bbox[1]}
                    fill={h.color}
                    opacity="0.4"
                  />
                ))}

              {liveHighlight && liveHighlight.page === pageIndex && (
                <rect
                  x={Math.min(liveHighlight.bbox[0], liveHighlight.bbox[2])}
                  y={Math.min(liveHighlight.bbox[1], liveHighlight.bbox[3])}
                  width={Math.abs(liveHighlight.bbox[2] - liveHighlight.bbox[0])}
                  height={Math.abs(liveHighlight.bbox[3] - liveHighlight.bbox[1])}
                  fill="#ffff00"
                  opacity="0.4"
                />
              )}

              {drawings
                .filter((d) => d.page === pageIndex)
                .map((d) => (
                  <polyline
                    key={d.id}
                    points={d.points.map((p) => p.join(",")).join(" ")}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={d.strokeWidth}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                ))}

              {liveStroke && liveStroke.page === pageIndex && (
                <polyline
                  points={liveStroke.points.map((p) => p.join(",")).join(" ")}
                  fill="none"
                  stroke={strokeColor}
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}