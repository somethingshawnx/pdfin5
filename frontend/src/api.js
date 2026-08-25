const API_BASE = "http://127.0.0.1:8000";

export async function getSession() {
  const res = await fetch(`${API_BASE}/api/session`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("Could not load session status");
  return res.json();
}

export async function uploadPdf(file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${API_BASE}/api/upload`, {
    method: "POST",
    credentials: "include",
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

export async function createOrder() {
  const res = await fetch(`${API_BASE}/api/create-order`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: "Could not start payment" }));
    throw new Error(err.detail || "Could not start payment");
  }
  return res.json();
}

export async function verifyPayment(payload) {
  const res = await fetch(`${API_BASE}/api/verify-payment`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res
      .json()
      .catch(() => ({ detail: "Payment verification failed" }));
    throw new Error(err.detail || "Payment verification failed");
  }
  return res.json();
}

export async function exportPdf(docId, operations) {
  const res = await fetch(`${API_BASE}/api/export/${docId}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operations }),
  });

  if (res.status === 402) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(
      body.detail?.message || "Payment required to continue.",
    );
    err.paymentRequired = true;
    err.session = body.detail?.session;
    throw err;
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: "Export failed" }));
    throw new Error(err.detail || "Export failed");
  }
  return res.blob();
}
