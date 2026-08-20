const API_BASE = "http://127.0.0.1:8000";

export async function uploadPdf(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Upload failed" }));
    throw new Error(err.detail || "Upload failed");
  }
  return res.json();
}

export function pageImageUrl(docId, pageNumber) {
  return `${API_BASE}/api/page-image/${docId}/${pageNumber}`;
}

export async function exportPdf(docId, operations) {
  const res = await fetch(`${API_BASE}/api/export/${docId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operations }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Export failed" }));
    throw new Error(err.detail || "Export failed");
  }
  return res.blob();
}
