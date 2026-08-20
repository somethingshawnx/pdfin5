import React, { useState } from "react";
import { uploadPdf } from "./api";
import Editor from "./Editor.jsx";

export default function App() {
  const [document, setDocument] = useState(null); // upload/analyze response
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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

  if (document) {
    return <Editor document={document} onStartOver={() => setDocument(null)} />;
  }

  return (
    <div className="upload-screen">
      <div className="upload-card">
        <h1>PDF Editor</h1>
        <p className="tagline">Click. Edit. Download.</p>
        <p className="subtext">
          Upload a PDF, click on existing text to edit it, then export the result.
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

        <p className="footnote">
          First 2 edits free, then editing from ₹5. Nothing is charged in this prototype yet.
        </p>
      </div>
    </div>
  );
}
