import React, { useState, useEffect } from "react";
import { uploadPdf, getSession } from "./api";
import Editor from "./Editor.jsx";

export default function App() {
  const [document, setDocument] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [session, setSession] = useState(null);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => {
        /* Backend might not be running yet - the upload step will surface that error. */
      });
  }, []);

  async function handleFileChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setLoading(true);
    try {
      const result = await uploadPdf(file);
      setDocument(result);
    } catch (err) {
      setError(err.message || "Something went wrong uploading the PDF.");
    } finally {
      setLoading(false);
    }
  }

  function refreshSession() {
    getSession()
      .then(setSession)
      .catch(() => {});
  }

  if (document) {
    return (
      <Editor
        document={document}
        onStartOver={() => {
          setDocument(null);
          refreshSession();
        }}
        session={session}
        onSessionChange={setSession}
      />
    );
  }

  const creditsLine = session
    ? session.requires_payment
      ? `You've used your ${session.free_edits} free edits. Editing now costs ₹${session.price_per_edit_inr} per export.`
      : `${session.free_edits_remaining} of ${session.free_edits} free edits remaining.`
    : "First 2 edits free, then editing from ₹5.";

  return (
    <div className="upload-screen">
      <div className="upload-card">
        <h1>PDF Editor</h1>
        <p className="tagline">Click. Edit. Download.</p>
        <p className="subtext">
          Upload a PDF, click on existing text to edit it, then export the
          result.
        </p>

        <label className="upload-dropzone">
          {loading ? "Analyzing your PDF…" : "Click to choose a PDF file"}
          <input
            type="file"
            accept="application/pdf"
            onChange={handleFileChange}
            disabled={loading}
            hidden
          />
        </label>

        {error && <div className="error-banner">{error}</div>}

        <p
          className={
            session?.requires_payment ? "footnote warning" : "footnote"
          }
        >
          {creditsLine} Nothing is charged in this prototype yet.
        </p>
      </div>
    </div>
  );
}
