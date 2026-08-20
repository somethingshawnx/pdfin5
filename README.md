# PDF Editor — Prototype

This is the first working slice of the blueprint: **upload a PDF → click on
existing text to edit it → add new text → download the result.**

It's two programs that run at the same time on your computer:

- `backend/` — a Python server (FastAPI) that reads PDFs and makes the edits.
- `frontend/` — a website (React) that you open in your browser to actually
  click and type.

Nothing is deployed to the internet yet — this all runs on your own Windows
machine while you're building it.

---

## 1. Install the tools you need (one-time setup)

You need three things installed on Windows. If you already have any of
these, skip that step.

1. **Python 3.11+** — download from https://www.python.org/downloads/
   During install, **check the box "Add python.exe to PATH"** before
   clicking Install. This is the step people miss most often.
2. **Node.js 20+ (LTS)** — download from https://nodejs.org/
   Just click through the installer with defaults.
3. **VS Code** — you said you already have this. Good.

To check they installed correctly, open a **new** terminal in VS Code
(Terminal → New Terminal) and run:

```
python --version
node --version
npm --version
```

Each should print a version number. If `python` isn't recognized, restart
VS Code (and your terminal) after installing — Windows needs a restart to
pick up the new PATH.

---

## 2. Open the project in VS Code

- File → Open Folder → select the `pdf-editor-prototype` folder you
  downloaded (the one containing this README).

You'll see two subfolders in the Explorer sidebar: `backend` and `frontend`.

---

## 3. Set up and run the backend (Python/FastAPI)

Open a terminal in VS Code (**Terminal → New Terminal**). It opens in the
project root by default — move into the backend folder:

```
cd backend
```

Create a virtual environment (an isolated Python setup just for this
project, so it doesn't clash with anything else on your machine):

```
python -m venv venv
```

Activate it:

```
venv\Scripts\activate
```

Your terminal prompt should now start with `(venv)`. Every time you open a
new terminal to work on the backend, run that activate command again first.

Install the required packages:

```
pip install -r requirements.txt
```

Start the server:

```
uvicorn main:app --reload
```

You should see something like `Uvicorn running on http://127.0.0.1:8000`.
**Leave this terminal running** — this is your backend server. To confirm
it's working, open http://127.0.0.1:8000/api/health in a browser; you
should see `{"status":"ok"}`.

---

## 4. Set up and run the frontend (React)

Open a **second** terminal in VS Code (click the `+` icon in the terminal
panel, or Terminal → New Terminal again) so the backend keeps running in
the first one.

```
cd frontend
npm install
npm run dev
```

You'll see a line like `Local: http://localhost:5173/`. Open that URL in
your browser (Ctrl+Click it in the VS Code terminal, or copy-paste it).

---

## 5. Try it out

1. Click the upload box, choose any PDF from your computer.
2. Click on a line of existing text — it turns into an editable box.
3. Type your change.
4. Click **+ Add Text** and click anywhere on the page to add brand-new
   text.
5. Click **Download PDF** — the edited file downloads through your browser.

Open the downloaded PDF and confirm your edits look right.

---

## How it works (so you can extend it)

- `backend/pdf_engine.py` — the actual PDF logic: reading text/font/position
  data out of a PDF, rendering page images, and applying edits on export.
  This is the piece from the blueprint's "PDF Intelligence Engine" and
  "Existing Text Editing Pipeline" sections.
- `backend/main.py` — the API routes the frontend calls
  (`/api/upload`, `/api/page-image/...`, `/api/export/...`).
- `frontend/src/Editor.jsx` — the click-to-edit canvas: shows the page image
  and draws an invisible clickable box over every piece of detected text.
- `frontend/src/App.jsx` — the upload screen.

### What this prototype does NOT include yet (by design)

Per the blueprint's phased roadmap, this build is **Phase 1–2 only**:

- No accounts, credits, or payments (Phase 4–5)
- No image editing yet — only text (Section 14 is next)
- No signature/draw/highlight tools yet (Section 15)
- Font matching always falls back to a built-in Helvetica-style font
  rather than truly preserving the original font (Section 7's "Font
  Resolver" is a real project on its own — happy to build that next)
- No scanned/OCR PDF support (Section 8 says this should wait)
- Files sit in `backend/storage/` on your machine with no automatic
  deletion yet (Section 19 requires this before any real launch)

### A note on redaction

When you edit existing text, the backend uses PyMuPDF's redaction feature,
which genuinely removes the underlying text object — not just draws a white
box over it. This matches the blueprint's requirement in Section 9 that
"true redaction must be implemented separately from visual whiteout."

---

## Troubleshooting

- **`pip install` fails on `pymupdf`** — make sure you're using Python
  3.11 or newer (`python --version`). Very old or very new (3.13+) Python
  versions sometimes lag behind on prebuilt PyMuPDF wheels.
- **Frontend loads but upload does nothing / network error** — make sure
  the backend terminal (Step 3) is still running and shows no errors.
- **"port already in use"** — you probably have a previous server still
  running in another terminal. Close it, or restart VS Code.
- **CORS error in the browser console** — the backend only allows
  `localhost:5173` by default (see `backend/main.py`). If you changed the
  frontend port, update the `allow_origins` list to match.

---

## Suggested next step

Once you're happy this works, the natural next slice (per the roadmap) is
**Phase 3: existing image editing** — select, move, resize, and replace
images on the page, using the `images` array that's already returned by
`/api/upload` but not yet wired into the editor UI.
