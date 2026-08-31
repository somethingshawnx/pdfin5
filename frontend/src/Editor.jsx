import React, { useState, useRef, useEffect } from "react";
import { pageImageUrl, exportPdf, getSession, createOrder, verifyPayment, fetchDocumentFonts } from "./api";

export default function Editor({ document, onStartOver, session, onSessionChange }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [editedText, setEditedText] = useState({});
  const [spanOverrides, setSpanOverrides] = useState({}); // per-span {font, size, bold, italic, underline, color}
  const [activeTextId, setActiveTextId] = useState(null);
  const [addedTexts, setAddedTexts] = useState([]);
  const [addMode, setAddMode] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [highlightMode, setHighlightMode] = useState(false);
  const [drawings, setDrawings] = useState([]);
  const [highlights, setHighlights] = useState([]);
  const [liveStroke, setLiveStroke] = useState(null);
  const [liveHighlight, setLiveHighlight] = useState(null);
  const [strokeColor, setStrokeColor] = useState("#1a1d23");
  const [docFonts, setDocFonts] = useState([]);
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

  useEffect(() => {
    // Reset state on document change
    setPageIndex(0);
    setEditedText({});
    setSpanOverrides({});
    setAddedTexts([]);
    setDrawings([]);
    setHighlights([]);
    setImageEdits({});
    setPhotos([]);
    setActiveTextId(null);
    setDocFonts([]);

    // Fetch custom fonts from backend and inject as @font-face
    fetchDocumentFonts(document.doc_id)
      .then((fonts) => {
        setDocFonts(fonts.map(f => f.family));
        const style = window.document.createElement("style");
        let css = "";
        fonts.forEach((f) => {
          css += `
            @font-face {
              font-family: "${f.family}";
              src: url("data:font/${f.format};base64,${f.base64}") format("${f.format}");
              font-weight: ${f.weight};
              font-style: ${f.style};
            }
          `;
        });
        style.innerHTML = css;
        window.document.head.appendChild(style);
      })
      .catch((err) => console.warn("Failed to load doc fonts", err));
  }, [document.doc_id]);

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
    ).length +
    Object.keys(spanOverrides).filter((id) => {
      const ov = spanOverrides[id];
      return ov && (ov.font !== undefined || ov.size !== undefined || ov.bold !== undefined);
    }).length +
    addedTexts.length + imageEditCount + drawings.length + highlights.length + photos.length;

  function findSpan(spanId) {
    return page.text_spans.find((s) => s.id === spanId);
  }

  function handleSpanClick(span) {
    if (addMode) return;
    setActiveTextId(span.id);
    if (!(span.id in editedText)) {
      setEditedText((prev) => ({ ...prev, [span.id]: span.text }));
    }
  }

  function handleCanvasClick(e) {
    if (!addMode) {
      setSelectedImageId(null);
      setSelectedPhotoId(null);
      // Don't unselect active text here because click on span handles it, 
      // but clicking canvas should blur. We'll handle it via onBlur or wrapper click.
      setActiveTextId(null);
      return;
    }
    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / displayScale / zoom;
    const y = (e.clientY - rect.top) / displayScale / zoom;
    const newBox = {
      id: `new_${Date.now()}`,
      page: pageIndex,
      bbox: [x, y, x + 150, y + 24],
      text: "",
      font_size: 16,
      font: "Helvetica",
      bold: false,
      italic: false,
      underline: false,
      color: "#000000",
    };
    setAddedTexts((prev) => [...prev, newBox]);
    setAddMode(false);
    setActiveTextId(newBox.id);
  }

  function updateAddedText(id, updates) {
    setAddedTexts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...updates } : t))
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
        const ov = spanOverrides[span.id] || {};
        const textChanged = newText !== undefined && newText !== span.text;
        const fmtChanged = ov.font !== undefined || ov.size !== undefined || ov.bold !== undefined || ov.italic !== undefined || ov.color !== undefined;
        if (textChanged || fmtChanged) {
          // Compute font_flags: bit 2^4 = bold (flag 16), 2^1 = italic (flag 2)
          const baseFlags = span.flags || 0;
          let newFlags = baseFlags;
          if (ov.bold === true) newFlags = newFlags | 16;
          else if (ov.bold === false) newFlags = newFlags & ~16;
          if (ov.italic === true) newFlags = newFlags | 2;
          else if (ov.italic === false) newFlags = newFlags & ~2;
          
          ops.push({
            type: "replace_text",
            page: p.page_number,
            bbox: span.bbox,
            old_text: span.text,
            new_text: newText !== undefined ? newText : span.text,
            font_size: ov.size !== undefined ? ov.size : span.size,
            color: ov.color !== undefined ? ov.color : span.color,
            font_name: ov.font !== undefined ? ov.font : span.font,
            font_flags: newFlags,
            underline: ov.underline || false
          });
        }
      }
    }

    for (const t of addedTexts) {
      if (t.text.trim() === "") continue;
      let flags = 0;
      if (t.bold) flags |= 16;
      if (t.italic) flags |= 2;
      ops.push({
        type: "add_text",
        page: t.page,
        bbox: t.bbox,
        text: t.text,
        font_size: t.font_size,
        color: t.color,
        font_name: t.font,
        font_flags: flags,
        underline: t.underline || false
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

  // Active span + its current effective formatting
  const activeSpan = activeTextId ? page.text_spans.find((s) => s.id === activeTextId) : null;
  const activeAddedText = activeTextId ? addedTexts.find((t) => t.id === activeTextId) : null;
  const isActive = activeSpan || activeAddedText;

  const activeOv = activeSpan ? (spanOverrides[activeTextId] || {}) : {};
  
  const activeFontFamily = activeAddedText ? activeAddedText.font : (activeOv.font !== undefined ? activeOv.font : (activeSpan?.font?.split("+").pop().split("-")[0] || "Helvetica"));
  const activeFontSize = activeAddedText ? activeAddedText.font_size : (activeOv.size !== undefined ? activeOv.size : (activeSpan ? Math.round(activeSpan.size) : 12));
  const activeBold = activeAddedText ? activeAddedText.bold : (activeOv.bold !== undefined ? activeOv.bold : ((activeSpan?.flags || 0) & 16) !== 0);
  const activeItalic = activeAddedText ? activeAddedText.italic : (activeOv.italic !== undefined ? activeOv.italic : ((activeSpan?.flags || 0) & 2) !== 0);
  const activeUnderline = activeAddedText ? activeAddedText.underline : (activeOv.underline !== undefined ? activeOv.underline : false);
  const activeColor = activeAddedText ? activeAddedText.color : (activeOv.color !== undefined ? activeOv.color : (activeSpan?.color || "#000000"));

  const COMMON_FONTS = [
    "Helvetica", "Times-Roman", "Courier", "Arial", "Georgia",
    "Verdana", "Trebuchet MS", "Comic Sans MS", "Impact", "Tahoma",
    ...docFonts
  ].filter((v, i, a) => a.indexOf(v) === i); // Unique fonts

  function setActiveFont(font) {
    if (activeAddedText) updateAddedText(activeTextId, { font });
    else if (activeSpan) setSpanOverrides((prev) => ({ ...prev, [activeTextId]: { ...(prev[activeTextId] || {}), font } }));
  }
  function setActiveFontSize(size) {
    const n = parseFloat(size);
    if (!isNaN(n) && n > 0) {
      if (activeAddedText) updateAddedText(activeTextId, { font_size: n });
      else if (activeSpan) setSpanOverrides((prev) => ({ ...prev, [activeTextId]: { ...(prev[activeTextId] || {}), size: n } }));
    }
  }
  function toggleActiveBold() {
    if (activeAddedText) updateAddedText(activeTextId, { bold: !activeBold });
    else if (activeSpan) setSpanOverrides((prev) => ({ ...prev, [activeTextId]: { ...(prev[activeTextId] || {}), bold: !activeBold } }));
  }
  function toggleActiveItalic() {
    if (activeAddedText) updateAddedText(activeTextId, { italic: !activeItalic });
    else if (activeSpan) setSpanOverrides((prev) => ({ ...prev, [activeTextId]: { ...(prev[activeTextId] || {}), italic: !activeItalic } }));
  }
  function toggleActiveUnderline() {
    if (activeAddedText) updateAddedText(activeTextId, { underline: !activeUnderline });
    else if (activeSpan) setSpanOverrides((prev) => ({ ...prev, [activeTextId]: { ...(prev[activeTextId] || {}), underline: !activeUnderline } }));
  }
  function setActiveColor(color) {
    if (activeAddedText) updateAddedText(activeTextId, { color });
    else if (activeSpan) setSpanOverrides((prev) => ({ ...prev, [activeTextId]: { ...(prev[activeTextId] || {}), color } }));
  }

  return (
    <div className="editor-screen">
      <div className="toolbar">
        <button className="ghost-btn" onClick={onStartOver} title="Upload a different PDF">
          ← New file
        </button>

        <div className="toolbar-sep" />

        {/* Tool buttons */}
        <div className="toolbar-group">
          <button className={addMode ? "tool-btn active" : "tool-btn"} onClick={toggleAddMode} title="Click the page to place a text box">
            T+ Text
          </button>
          <button className="tool-btn" onClick={triggerPhotoUpload} title="Add an image or signature photo">
            🖼 Image
          </button>
          <button className={drawMode ? "tool-btn active" : "tool-btn"} onClick={toggleDrawMode} title="Freehand pen / draw signature">
            ✏️ Draw
          </button>
          <button className={highlightMode ? "tool-btn active" : "tool-btn"} onClick={toggleHighlightMode} title="Drag to highlight text">
            🖊 Highlight
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
        </div>

        {/* Draw colors / undo */}
        {drawMode && (
          <>
            <div className="toolbar-sep" />
            <div className="toolbar-group">
              {["#ffffff", "#1a1d23", "#ef4444", "#6c47ff", "#10b981"].map((c) => (
                <button
                  key={c}
                  className={strokeColor === c ? "color-swatch active" : "color-swatch"}
                  style={{ background: c, border: strokeColor === c ? "2px solid #a78bfa" : "2px solid #3d3d6b" }}
                  onClick={() => setStrokeColor(c)}
                  title="Pen color"
                />
              ))}
              <button className="ghost-btn small" onClick={undoLastDrawing}>⟲ Undo</button>
            </div>
          </>
        )}
        {highlightMode && (
          <>
            <div className="toolbar-sep" />
            <button className="ghost-btn small" onClick={undoLastHighlight}>⟲ Undo</button>
          </>
        )}

        {/* Active text formatting controls */}
        {isActive && (
          <>
            <div className="toolbar-sep" />
            <div
              className="toolbar-group"
              style={{ gap: 5, alignItems: "center" }}
            >
              <select
                className="font-select"
                value={activeFontFamily}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setActiveFont(e.target.value)}
                title="Font family"
              >
                {COMMON_FONTS.map((f) => (
                  <option key={f} value={f}>{f}</option>
                ))}
                {!COMMON_FONTS.includes(activeFontFamily) && (
                  <option value={activeFontFamily}>{activeFontFamily}</option>
                )}
              </select>

              <input
                className="font-size-input"
                type="number"
                min="4"
                max="200"
                step="0.5"
                value={activeFontSize}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setActiveFontSize(e.target.value)}
                title="Font size (pt)"
              />

              <button
                className={activeBold ? "fmt-btn active" : "fmt-btn"}
                onMouseDown={(e) => { e.preventDefault(); toggleActiveBold(); }}
                title="Bold"
                style={{ fontWeight: "bold" }}
              >
                B
              </button>

              <button
                className={activeItalic ? "fmt-btn active" : "fmt-btn"}
                onMouseDown={(e) => { e.preventDefault(); toggleActiveItalic(); }}
                title="Italic"
                style={{ fontStyle: "italic" }}
              >
                I
              </button>

              <button
                className={activeUnderline ? "fmt-btn active" : "fmt-btn"}
                onMouseDown={(e) => { e.preventDefault(); toggleActiveUnderline(); }}
                title="Underline"
                style={{ textDecoration: "underline" }}
              >
                U
              </button>

              <input
                type="color"
                className="color-picker-input"
                value={activeColor}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => setActiveColor(e.target.value)}
                title="Text Color"
              />
            </div>
          </>
        )}

        {/* Page nav */}
        <div className="toolbar-group page-nav">
          <button
            className="ghost-btn"
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => Math.max(0, i - 1))}
          >
            ‹
          </button>
          <span>Page {pageIndex + 1} / {document.page_count}</span>
          <button
            className="ghost-btn"
            disabled={pageIndex === document.page_count - 1}
            onClick={() => setPageIndex((i) => Math.min(document.page_count - 1, i + 1))}
          >
            ›
          </button>
        </div>

        {/* Zoom */}
        <div className="toolbar-group">
          <button className="zoom-btn" onClick={zoomOut} title="Zoom out">−</button>
          <button className="zoom-pct" onClick={resetZoom}>{Math.round(displayScale * 100)}%</button>
          <button className="zoom-btn" onClick={zoomIn} title="Zoom in">+</button>
        </div>

        <div className="toolbar-sep" />

        {/* Credits + Download */}
        <div className="toolbar-group">
          <span className={session?.requires_payment ? "edit-count warning" : "edit-count"}>
            {session
              ? session.requires_payment
                ? "⚠ No free exports left"
                : `${session.free_edits_remaining} free left`
              : ""}
          </span>
          {editedCount > 0 && <span className="edit-count">{editedCount} edit{editedCount !== 1 ? "s" : ""}</span>}
          <button className="primary-btn" onClick={handleExport} disabled={exporting}>
            {exporting ? "Exporting…" : "⬇ Download PDF"}
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
              const spanH = (y1 - y0) * zoom;
              const spanW = (x1 - x0) * zoom;
              const fontSize = span.size * zoom * 0.75;

              // Base position/size for overlay
              const baseStyle = {
                left: x0 * zoom,
                top: y0 * zoom,
                width: spanW,
                height: spanH,
                fontSize,
                lineHeight: `${spanH}px`,
                color: span.color,
              };

              const isEdited =
                editedText[span.id] !== undefined && editedText[span.id] !== span.text;

              // Active editing — show a textarea that covers the original text
              if (activeTextId === span.id) {
                const ov2 = spanOverrides[span.id] || {};
                const previewSize = ov2.size !== undefined ? ov2.size * zoom * 0.75 : fontSize;
                const previewBold = ov2.bold !== undefined ? ov2.bold : ((span.flags || 0) & 16) !== 0;
                const previewItalic = ov2.italic !== undefined ? ov2.italic : ((span.flags || 0) & 2) !== 0;
                
                return (
                  <textarea
                    key={span.id}
                    className="span-editor active"
                    style={{
                      ...baseStyle,
                      left: baseStyle.left - 5, // offset padding/border
                      top: baseStyle.top - 1,   // offset border
                      // Extend width a bit so user has room to type more
                      width: Math.max(spanW + 10, 120),
                      minWidth: spanW + 10,
                      fontSize: previewSize,
                      lineHeight: `${spanH}px`,
                      fontWeight: previewBold ? "bold" : "normal",
                      fontStyle: previewItalic ? "italic" : "normal",
                      textDecoration: ov2.underline ? "underline" : "none",
                      fontFamily: ov2.font || "inherit",
                      color: ov2.color !== undefined ? ov2.color : span.color,
                    }}
                    autoFocus
                    value={editedText[span.id] ?? span.text}
                    onChange={(e) =>
                      setEditedText((prev) => ({ ...prev, [span.id]: e.target.value }))
                    }
                    onBlur={(e) => {
                      const related = e.relatedTarget;
                      if (related && related.closest && related.closest('.toolbar')) return;
                      setActiveTextId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                );
              }

              // Edited (not currently active) — opaque white box covering old text
              if (isEdited) {
                const ov3 = spanOverrides[span.id] || {};
                const previewBold = ov3.bold !== undefined ? ov3.bold : ((span.flags || 0) & 16) !== 0;
                const previewItalic = ov3.italic !== undefined ? ov3.italic : ((span.flags || 0) & 2) !== 0;
                // Use original PDF font name as fallback for accurate preview
                const rawFont = span.font?.split("+").pop() || "";
                const fontFamilyFallback = ov3.font || rawFont.split("-")[0] || "inherit";
                return (
                  <div
                    key={span.id}
                    className="span-box edited"
                    style={{
                      ...baseStyle,
                      left: baseStyle.left - 2,
                      width: "max-content",
                      minWidth: spanW + 4,
                      background: "white",
                      paddingLeft: 2,
                      paddingRight: 4,
                      whiteSpace: "nowrap",
                      fontFamily: fontFamilyFallback,
                      fontWeight: previewBold ? "bold" : "normal",
                      fontStyle: previewItalic ? "italic" : "normal",
                      textDecoration: ov3.underline ? "underline" : "none",
                      color: ov3.color !== undefined ? ov3.color : span.color,
                      fontSize: ov3.size !== undefined ? ov3.size * zoom * 0.75 : fontSize,
                    }}
                    title="Click to re-edit"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSpanClick(span);
                    }}
                  >
                    {editedText[span.id]}
                  </div>
                );
              }

              // Normal unedited span — invisible hover target
              return (
                <div
                  key={span.id}
                  className="span-box"
                  style={baseStyle}
                  title="Click to edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSpanClick(span);
                  }}
                />
              );
            })}

            {addedTexts
              .filter((t) => t.page === pageIndex)
              .map((t) => {
                const [x0, y0] = t.bbox;
                const isActiveAdded = activeTextId === t.id;
                const style = {
                  left: x0 * zoom,
                  top: y0 * zoom,
                  fontSize: t.font_size * zoom * 0.75,
                  color: t.color,
                  fontFamily: t.font || "inherit",
                  fontWeight: t.bold ? "bold" : "normal",
                  fontStyle: t.italic ? "italic" : "normal",
                  textDecoration: t.underline ? "underline" : "none",
                };
                return (
                  <div
                    key={t.id}
                    className={`added-text-wrap ${isActiveAdded ? 'active' : ''}`}
                    style={style}
                    onClick={(e) => { e.stopPropagation(); setActiveTextId(t.id); }}
                  >
                    <input
                      className="span-editor added"
                      style={{
                        minWidth: "150px",
                        width: "max-content",
                        background: isActiveAdded ? "rgba(255,255,255,0.95)" : "transparent",
                        border: isActiveAdded ? "2px dashed var(--accent)" : "2px dashed transparent",
                        cursor: isActiveAdded ? "text" : "pointer",
                        padding: "2px 4px",
                        outline: "none",
                        fontSize: "inherit",
                        fontFamily: "inherit",
                        fontWeight: "inherit",
                        fontStyle: "inherit",
                        textDecoration: "inherit",
                        color: "inherit",
                      }}
                      value={t.text}
                      placeholder="Type text…"
                      onChange={(e) => updateAddedText(t.id, { text: e.target.value })}
                    />
                    {/* Always render remove-btn but hide it; use onMouseDown+preventDefault so blur doesn't clear activeTextId before delete fires */}
                    <button
                      className="remove-btn"
                      style={{ display: isActiveAdded ? "flex" : "none" }}
                      onMouseDown={(e) => {
                        e.preventDefault();
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