import React, { useState, useEffect, useRef, useCallback } from "react";
import { uploadPdf, getSession } from "./api";
import Editor from "./Editor.jsx";

const FEATURES = [
  { icon: "✏️", title: "Edit Existing Text", desc: "Click any text in your PDF and change it. Fonts and styles are preserved automatically." },
  { icon: "🖼️", title: "Images & Signatures", desc: "Replace, move, or resize images. Draw or upload your signature in seconds." },
  { icon: "🖊️", title: "Draw & Highlight", desc: "Annotate with freehand pen, highlight important sections, and add shapes." },
  { icon: "💳", title: "Pay Only When Ready", desc: "Make all your edits first. Only pay ₹5 when you download — 2 exports always free." },
];

const STEPS = [
  { n: "1", title: "Upload your PDF", desc: "Drag & drop or click to choose any PDF file up to 25 MB." },
  { n: "2", title: "Click & Edit", desc: "Hover over text or images to select them. Click to edit inline." },
  { n: "3", title: "Download", desc: "Hit Download. First 2 exports are free, then just ₹5 each." },
];

const FAQ = [
  { q: "Does editing change the original file?", a: "No. Your original PDF is never modified. We create a new file with your edits applied." },
  { q: "How long are files kept?", a: "Uploaded files are automatically deleted within 24 hours of upload." },
  { q: "What PDFs are supported?", a: "Native/digital PDFs work best. Scanned image-only PDFs have limited support." },
  { q: "Is my document secure?", a: "Files are processed over HTTPS, stored temporarily, then permanently deleted." },
];

export default function App() {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [openFaq, setOpenFaq] = useState(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    getSession().then(setSession).catch(() => {});
  }, []);

  async function processFile(file) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setError("Please choose a PDF file.");
      return;
    }
    if (file.size > 25 * 1024 * 1024) {
      setError("File must be under 25 MB.");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const result = await uploadPdf(file);
      setDocument(result);
    } catch (err) {
      setError(err.message || "Upload failed. Is the backend running?");
    } finally {
      setLoading(false);
    }
  }

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  }, []);

  const handleDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const handleDragLeave = () => setDragOver(false);

  function refreshSession() {
    getSession().then(setSession).catch(() => {});
  }

  if (document) {
    return (
      <Editor
        document={document}
        onStartOver={() => { setDocument(null); refreshSession(); }}
        session={session}
        onSessionChange={setSession}
      />
    );
  }

  const creditsLine = session
    ? session.requires_payment
      ? `Free edits used. Exports now cost ₹${session.price_per_edit_inr} each.`
      : `${session.free_edits_remaining} of ${session.free_edits} free exports remaining.`
    : "First 2 exports free · Then from ₹5";

  return (
    <div className="landing">
      {/* ── HERO ── */}
      <section className="hero">
        <div className="hero-badge">✨ 2 free exports · No sign-up needed</div>
        <h1>Edit any PDF.<br /><span>In seconds.</span></h1>
        <p className="hero-sub">
          Click on existing text, change it, add images or signatures — then download. No complicated software. No subscription.
        </p>

        <div className="hero-upload-area">
          <label
            className={`upload-dropzone${dragOver ? " drag-over" : ""}`}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
          >
            {loading ? (
              <div className="spinner-wrap">
                <div className="spinner" />
                <span>Analyzing your PDF…</span>
              </div>
            ) : (
              <>
                <div className="upload-icon">📄</div>
                <div className="upload-text">Drop your PDF here</div>
                <div className="upload-hint">or click to browse · Max 25 MB</div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              hidden
              onChange={(e) => processFile(e.target.files?.[0])}
              disabled={loading}
            />
          </label>

          <button
            className="upload-cta-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
          >
            {loading ? "Analyzing…" : "Choose PDF to Edit →"}
          </button>

          {error && <div className="error-banner">{error}</div>}

          <p className={`credits-line${session?.requires_payment ? " warn" : ""}`}>
            {creditsLine}
          </p>
        </div>

        <div className="hero-trust">
          <span className="trust-item"><span className="dot">●</span> No sign-up required</span>
          <span className="trust-item"><span className="dot">●</span> Files deleted in 24h</span>
          <span className="trust-item"><span className="dot">●</span> HTTPS encrypted</span>
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section className="features-section">
        <div className="section-label">Why PDFin5</div>
        <h2 className="section-title">Everything you need to edit a PDF</h2>
        <div className="features-grid">
          {FEATURES.map((f) => (
            <div className="feature-card" key={f.title}>
              <div className="feature-icon">{f.icon}</div>
              <h3>{f.title}</h3>
              <p>{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="steps-section">
        <div className="section-label" style={{ color: "#a78bfa" }}>How it works</div>
        <h2 className="section-title">Click. Edit. Download.</h2>
        <div className="steps-grid">
          {STEPS.map((s) => (
            <div className="step-item" key={s.n}>
              <div className="step-num">{s.n}</div>
              <h3>{s.title}</h3>
              <p>{s.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── PRICING ── */}
      <section className="pricing-section">
        <div className="section-label">Pricing</div>
        <h2 className="section-title">Fair & transparent</h2>
        <div className="pricing-cards">
          <div className="pricing-card">
            <h3>Free</h3>
            <div className="pricing-amount">₹0</div>
            <p className="pricing-desc">2 complete exports, no account needed</p>
            <ul className="pricing-features">
              <li>Edit existing text</li>
              <li>Add text & images</li>
              <li>Draw & highlight</li>
              <li>2 PDF downloads</li>
            </ul>
          </div>
          <div className="pricing-card featured">
            <div className="pricing-badge">MOST POPULAR</div>
            <h3>Pay As You Go</h3>
            <div className="pricing-amount"><span>₹</span>5</div>
            <p className="pricing-desc">Per export · No subscription ever</p>
            <ul className="pricing-features">
              <li>All free features</li>
              <li>Unlimited edits per PDF</li>
              <li>Font style matching</li>
              <li>Secure processing</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="features-section" style={{ background: "var(--bg)" }}>
        <div className="section-label">FAQ</div>
        <h2 className="section-title">Common questions</h2>
        <div style={{ maxWidth: 640, margin: "0 auto", display: "flex", flexDirection: "column", gap: 12 }}>
          {FAQ.map((item, i) => (
            <div
              key={i}
              style={{
                background: "var(--card-bg)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                overflow: "hidden",
              }}
            >
              <button
                onClick={() => setOpenFaq(openFaq === i ? null : i)}
                style={{
                  width: "100%",
                  padding: "16px 20px",
                  background: "none",
                  border: "none",
                  textAlign: "left",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontFamily: "inherit",
                  fontSize: 15,
                  fontWeight: 600,
                  color: "var(--ink)",
                }}
              >
                {item.q}
                <span style={{ color: "var(--accent)", fontSize: 18, flexShrink: 0 }}>
                  {openFaq === i ? "−" : "+"}
                </span>
              </button>
              {openFaq === i && (
                <div style={{ padding: "0 20px 16px", color: "var(--muted)", fontSize: 14, lineHeight: 1.7 }}>
                  {item.a}
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="landing-footer">
        <p>© 2026 PDFin5 · <a href="#">Privacy Policy</a> · <a href="#">Terms</a></p>
        <p style={{ marginTop: 6 }}>Files are automatically deleted within 24 hours. We never sell your data.</p>
      </footer>
    </div>
  );
}
