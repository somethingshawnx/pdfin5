import React, { useState, useRef, useEffect } from "react";
import { pageImageUrl, exportPdf } from "./api";

export default function Editor({ document, onStartOver }) {
  const [pageIndex, setPageIndex] = useState(0);
  const [editedText, setEditedText] = useState({});
  const [activeSpanId, setActiveSpanId] = useState(null);
  const [addedTexts, setAddedTexts] = useState([]);
  const [addMode, setAddMode] = useState(false);
  const [imageEdits, setImageEdits] = useState({});
  const [selectedImageId, setSelectedImageId] = useState(null);
  const fileInputRefs = useRef({});
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
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
      const scale =
        availableWidth > 0 ? Math.min(1, availableWidth / imgWidth) : 1;
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
        x0 += dxPdf;
        x1 += dxPdf;
        y0 += dyPdf;
        y1 += dyPdf;
      } else if (mode === "resize-se") {
        x1 += dxPdf;
        y1 += dyPdf;
      } else if (mode === "resize-sw") {
        x0 += dxPdf;
        y1 += dyPdf;
      } else if (mode === "resize-ne") {
        x1 += dxPdf;
        y0 += dyPdf;
      } else if (mode === "resize-nw") {
        x0 += dxPdf;
        y0 += dyPdf;
      }

      if (x1 - x0 < 10) {
        if (mode.includes("w")) x0 = x1 - 10;
        else x1 = x0 + 10;
      }
      if (y1 - y0 < 10) {
        if (mode.includes("n")) y0 = y1 - 10;
        else y1 = y0 + 10;
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

  const imageEditCount = Object.keys(imageEdits).filter((id) => {
    const edit = imageEdits[id];
    const img = document.pages
      .flatMap((p) => p.images)
      .find((i) => i.id === id);
    if (!img) return false;
    const bboxChanged =
      edit.bbox && JSON.stringify(edit.bbox) !== JSON.stringify(img.bbox);
    return bboxChanged || !!edit.replacementBase64;
  }).length;

  const editedCount =
    Object.keys(editedText).filter(
      (id) => editedText[id] !== findSpan(id)?.text,
    ).length +
    addedTexts.length +
    imageEditCount;

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
      prev.map((t) => (t.id === id ? { ...t, text } : t)),
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
        const bboxChanged =
          JSON.stringify(newBbox) !== JSON.stringify(img.bbox);
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

    return ops;
  }

  async function handleExport() {
    setExportError("");
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
    } catch (err) {
      setExportError(err.message || "Export failed.");
    } finally {
      setExporting(false);
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
            onClick={() => setAddMode((v) => !v)}
          >
            + Add Text
          </button>
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
          <button
            className="zoom-pct"
            onClick={resetZoom}
            title="Reset to fit width"
          >
            {Math.round(displayScale * 100)}%
          </button>
          <button className="zoom-btn" onClick={zoomIn} title="Zoom in">
            +
          </button>
        </div>

        <div className="toolbar-group">
          <span className="edit-count">{editedCount} edit(s)</span>
          <button
            className="primary-btn"
            onClick={handleExport}
            disabled={exporting}
          >
            {exporting ? "Exporting…" : "Download PDF"}
          </button>
        </div>
      </div>

      {exportError && <div className="error-banner">{exportError}</div>}
      {addMode && (
        <div className="hint-banner">
          Click anywhere on the page to place new text.
        </div>
      )}

      <div className="canvas-scroll" ref={scrollRef}>
        <div
          className="page-canvas-wrapper"
          style={{
            width: imgWidth * displayScale,
            height: imgHeight * displayScale,
          }}
        >
          <div
            className="page-canvas"
            ref={canvasRef}
            style={{
              width: imgWidth,
              height: imgHeight,
              transform: `scale(${displayScale})`,
              transformOrigin: "top left",
              cursor: addMode ? "crosshair" : "default",
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
                editedText[span.id] !== undefined &&
                editedText[span.id] !== span.text;

              if (activeSpanId === span.id) {
                return (
                  <textarea
                    key={span.id}
                    className="span-editor active"
                    style={style}
                    autoFocus
                    value={editedText[span.id] ?? span.text}
                    onChange={(e) =>
                      setEditedText((prev) => ({
                        ...prev,
                        [span.id]: e.target.value,
                      }))
                    }
                    onBlur={() => setActiveSpanId(null)}
                  />
                );
              }

              return (
                <div
                  key={span.id}
                  className={isEdited ? "span-box edited" : "span-box"}
                  style={style}
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
                          onMouseDown={(e) =>
                            startImageDrag(e, img, `resize-${corner}`)
                          }
                        />
                      ))}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
