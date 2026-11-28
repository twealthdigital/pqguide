"""
PQGuide Surya OCR + Layout + Table + Cropped-Line HTR Microservice

Supports:
  1. Modern Surya v2+ (`SuryaInferenceManager`, `LayoutPredictor`, `RecognitionPredictor`, `TableRecPredictor`)
  2. Surya v0.13–0.17 (`FoundationPredictor`, `DetectionPredictor`, `LayoutPredictor`, `RecognitionPredictor`, `TableRecPredictor`)
  3. Optional cropped handwritten-line transcription (`microsoft/trocr-base-handwritten`) via `/htr`

Endpoints:
  GET  /health
  POST /analyze   (JSON base64 or multipart image/PDF)
  POST /ocr       (alias for /analyze)
  POST /htr       (cropped handwritten line image -> text + confidence)
"""

from __future__ import annotations

import base64
import io
import os
import re
import time
from typing import Any, Dict, List, Optional

from bs4 import BeautifulSoup
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image
from pydantic import BaseModel, Field

app = FastAPI(title="PQGuide Surya Document Intelligence Service", version="1.0.0")

MAX_UPLOAD_BYTES = int(os.environ.get("SURYA_MAX_IMAGE_BYTES", str(20 * 1024 * 1024)))
MAX_PDF_PAGES = int(os.environ.get("SURYA_MAX_PDF_PAGES", "20"))
PDF_RENDER_SCALE = float(os.environ.get("SURYA_PDF_RENDER_SCALE", "2.0"))
TROCR_MODEL_ID = os.environ.get("PQGUIDE_HTR_MODEL", "microsoft/trocr-base-handwritten")
ENABLE_TROCR = os.environ.get("PQGUIDE_ENABLE_HTR", "true").lower() not in {"0", "false", "no"}


class Base64AnalyzeRequest(BaseModel):
    imageBase64: Optional[str] = None
    mimeType: Optional[str] = "image/png"
    pageNumber: int = 1
    languages: List[str] = Field(default_factory=lambda: ["en"])
    extractTables: bool = True
    extractEquations: bool = True


class Base64HtrRequest(BaseModel):
    imageBase64: str
    mimeType: Optional[str] = "image/png"
    promptHint: Optional[str] = None


class RuntimeState:
    def __init__(self) -> None:
        self.api_mode: Optional[str] = None
        self.load_error: Optional[str] = None
        self.manager: Any = None
        self.foundation: Any = None
        self.det_predictor: Any = None
        self.layout_predictor: Any = None
        self.rec_predictor: Any = None
        self.table_predictor: Any = None
        self.htr_processor: Any = None
        self.htr_model: Any = None
        self.htr_error: Optional[str] = None
        self.device: str = "cpu"

    def detect_device(self) -> str:
        try:
            import torch

            if torch.cuda.is_available():
                return "cuda"
            if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                return "mps"
        except Exception:
            pass
        return "cpu"

    def ensure_surya(self) -> None:
        if self.rec_predictor is not None:
            return
        self.device = self.detect_device()

        # Attempt modern Surya v2+ API first (`SuryaInferenceManager`)
        try:
            from surya.inference import SuryaInferenceManager
            from surya.layout import LayoutPredictor
            from surya.recognition import RecognitionPredictor

            self.manager = SuryaInferenceManager()
            self.layout_predictor = LayoutPredictor(self.manager)
            self.rec_predictor = RecognitionPredictor(self.manager)
            try:
                from surya.table_rec import TableRecPredictor

                self.table_predictor = TableRecPredictor(self.manager)
            except Exception:
                self.table_predictor = None
            self.api_mode = "surya_v2_inference_manager"
            self.load_error = None
            return
        except ImportError:
            pass
        except Exception as exc:
            self.load_error = f"Surya v2 init failed: {exc}"

        # Fallback to Surya v0.13-0.17 Predictor stack (`FoundationPredictor`)
        try:
            from surya.detection import DetectionPredictor
            from surya.foundation import FoundationPredictor
            from surya.layout import LayoutPredictor
            from surya.recognition import RecognitionPredictor
            from surya.table_rec import TableRecPredictor

            self.foundation = FoundationPredictor()
            self.det_predictor = DetectionPredictor()
            self.layout_predictor = LayoutPredictor()
            self.rec_predictor = RecognitionPredictor(self.foundation)
            self.table_predictor = TableRecPredictor()
            self.api_mode = "surya_v0_foundation"
            self.load_error = None
            return
        except Exception as exc:
            self.load_error = f"Unable to initialize Surya OCR predictors: {exc}"
            raise RuntimeError(self.load_error) from exc

    def ensure_htr(self) -> bool:
        if not ENABLE_TROCR:
            self.htr_error = "HTR disabled by PQGUIDE_ENABLE_HTR=false"
            return False
        if self.htr_model is not None and self.htr_processor is not None:
            return True
        try:
            import torch
            from transformers import TrOCRProcessor, VisionEncoderDecoderModel

            self.device = self.detect_device()
            self.htr_processor = TrOCRProcessor.from_pretrained(TROCR_MODEL_ID)
            self.htr_model = VisionEncoderDecoderModel.from_pretrained(TROCR_MODEL_ID)
            self.htr_model.to(self.device)
            self.htr_model.eval()
            self.htr_error = None
            return True
        except Exception as exc:
            self.htr_error = f"TrOCR model load failed: {exc}"
            return False


runtime = RuntimeState()


def _decode_base64_payload(raw: str) -> bytes:
    clean = re.sub(r"^data:[^;]+;base64,", "", raw.strip())
    data = base64.b64decode(clean, validate=False)
    if not data or len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image/PDF payload is empty or exceeds size limit.")
    return data


def _rasterize_bytes(payload: bytes, mime_hint: Optional[str] = None) -> List[Image.Image]:
    if payload[:4] == b"%PDF" or (mime_hint and "pdf" in mime_hint.lower()):
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(payload)
        pages: List[Image.Image] = []
        total = min(len(pdf), MAX_PDF_PAGES)
        for idx in range(total):
            page = pdf[idx]
            bitmap = page.render(scale=PDF_RENDER_SCALE)
            pil_img = bitmap.to_pil().convert("RGB")
            pages.append(pil_img)
        if not pages:
            raise HTTPException(status_code=422, detail="PDF has zero renderable pages.")
        return pages

    try:
        img = Image.open(io.BytesIO(payload)).convert("RGB")
        return [img]
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid image payload: {exc}") from exc


def _normalize_bbox(raw_bbox: Any, img_w: int, img_h: int) -> Dict[str, int]:
    if isinstance(raw_bbox, (list, tuple)) and len(raw_bbox) >= 4:
        x0, y0, x1, y1 = [float(v) for v in raw_bbox[:4]]
        return {
            "x": max(0, int(round(x0))),
            "y": max(0, int(round(y0))),
            "width": max(1, int(round(x1 - x0))),
            "height": max(1, int(round(y1 - y0))),
            "x0": max(0, int(round(x0))),
            "y0": max(0, int(round(y0))),
            "x1": min(img_w, int(round(x1))),
            "y1": min(img_h, int(round(y1))),
        }
    return {"x": 0, "y": 0, "width": img_w, "height": img_h, "x0": 0, "y0": 0, "x1": img_w, "y1": img_h}


def _extract_html_equations_and_tables(html_content: str) -> Dict[str, Any]:
    soup = BeautifulSoup(html_content or "", "html.parser")
    equations: List[Dict[str, Any]] = []
    tables: List[Dict[str, Any]] = []

    for math_tag in soup.find_all(["math", "span"]):
        cls = " ".join(math_tag.get("class") or [])
        if math_tag.name == "math" or "math" in cls.lower() or "katex" in cls.lower():
            tex = math_tag.get("alttext") or math_tag.get_text(" ", strip=True)
            if tex:
                equations.append({
                    "latex": tex,
                    "displayMode": (math_tag.get("display") == "block"),
                })

    for tbl in soup.find_all("table"):
        headers: List[str] = []
        rows: List[List[str]] = []
        for idx, tr in enumerate(tbl.find_all("tr")):
            ths = tr.find_all("th")
            tds = tr.find_all("td")
            if ths and not headers:
                headers = [c.get_text(" ", strip=True) for c in ths]
                if tds:
                    rows.append([c.get_text(" ", strip=True) for c in tds])
            else:
                cells = [c.get_text(" ", strip=True) for c in (ths + tds)]
                if idx == 0 and not headers:
                    headers = cells
                elif cells:
                    rows.append(cells)
        if headers or rows:
            tables.append({"headers": headers, "rows": rows})

    plain_text = re.sub(r"\n{3,}", "\n\n", soup.get_text("\n", strip=True)).strip()
    return {"plainText": plain_text, "equations": equations, "tables": tables}


def _analyze_pages(
    images: List[Image.Image],
    start_page_number: int = 1,
    languages: Optional[List[str]] = None,
) -> Dict[str, Any]:
    t0 = time.perf_counter()
    runtime.ensure_surya()
    pages_out: List[Dict[str, Any]] = []

    if runtime.api_mode == "surya_v2_inference_manager":
        layouts = runtime.layout_predictor(images)
        rec_results = runtime.rec_predictor(images, layouts)

        for idx, img in enumerate(images):
            w, h = img.size
            layout_obj = layouts[idx] if idx < len(layouts) else None
            rec_obj = rec_results[idx] if idx < len(rec_results) else None

            blocks_out: List[Dict[str, Any]] = []
            lines_out: List[Dict[str, Any]] = []
            equations_out: List[Dict[str, Any]] = []
            tables_out: List[Dict[str, Any]] = []
            confidences: List[float] = []

            raw_blocks = getattr(rec_obj, "blocks", None) or []
            layout_bboxes = getattr(layout_obj, "bboxes", None) or []

            for b_idx, blk in enumerate(raw_blocks):
                raw_html = getattr(blk, "html", None) or getattr(blk, "text", "") or ""
                label = str(getattr(blk, "label", "Text") or "Text")
                raw_bbox = getattr(blk, "bbox", None)
                if raw_bbox is None and b_idx < len(layout_bboxes):
                    raw_bbox = getattr(layout_bboxes[b_idx], "bbox", None)
                bbox = _normalize_bbox(raw_bbox, w, h)
                parsed = _extract_html_equations_and_tables(raw_html)
                conf = getattr(blk, "confidence", None)
                conf_pct = round(float(conf) * 100.0, 2) if isinstance(conf, (int, float)) else 91.0
                confidences.append(conf_pct)

                blocks_out.append({
                    "order": b_idx,
                    "label": label,
                    "html": raw_html,
                    "text": parsed["plainText"],
                    "confidence": conf_pct,
                    "bbox": bbox,
                })

                if parsed["plainText"]:
                    lines_out.append({
                        "text": parsed["plainText"],
                        "confidence": conf_pct,
                        "bbox": {"x0": bbox["x0"], "y0": bbox["y0"], "x1": bbox["x1"], "y1": bbox["y1"]},
                    })

                for eq in parsed["equations"]:
                    equations_out.append({
                        "latex": eq["latex"],
                        "displayMode": eq["displayMode"],
                        "confidence": conf_pct,
                        "bbox": bbox,
                    })

                for tbl in parsed["tables"]:
                    tables_out.append({
                        "headers": tbl["headers"],
                        "rows": tbl["rows"],
                        "bbox": bbox,
                    })

            page_text = "\n\n".join(b["text"] for b in blocks_out if b["text"]).strip()
            avg_conf = round(sum(confidences) / len(confidences), 2) if confidences else 0.0

            pages_out.append({
                "pageNumber": start_page_number + idx,
                "width": w,
                "height": h,
                "text": page_text,
                "confidence": avg_conf,
                "blocks": blocks_out,
                "lines": lines_out,
                "equations": equations_out,
                "tables": tables_out,
            })
    else:
        # Surya v0.13-0.17 predictor stack
        layouts = runtime.layout_predictor(images)
        rec_results = runtime.rec_predictor(
            images,
            det_predictor=runtime.det_predictor,
        )
        table_results = runtime.table_predictor(images) if runtime.table_predictor else [None] * len(images)

        for idx, img in enumerate(images):
            w, h = img.size
            rec_obj = rec_results[idx] if idx < len(rec_results) else None
            layout_obj = layouts[idx] if idx < len(layouts) else None
            tbl_obj = table_results[idx] if idx < len(table_results) else None

            text_lines = getattr(rec_obj, "text_lines", None) or []
            lines_out: List[Dict[str, Any]] = []
            confidences: List[float] = []
            for ln in text_lines:
                txt = str(getattr(ln, "text", "") or "").strip()
                conf = getattr(ln, "confidence", None)
                conf_pct = round(float(conf) * 100.0, 2) if isinstance(conf, (int, float)) else 88.0
                bbox = _normalize_bbox(getattr(ln, "bbox", None), w, h)
                if txt:
                    confidences.append(conf_pct)
                    lines_out.append({
                        "text": txt,
                        "confidence": conf_pct,
                        "bbox": {"x0": bbox["x0"], "y0": bbox["y0"], "x1": bbox["x1"], "y1": bbox["y1"]},
                    })

            blocks_out: List[Dict[str, Any]] = []
            for order_idx, lbox in enumerate(getattr(layout_obj, "bboxes", None) or []):
                bbox = _normalize_bbox(getattr(lbox, "bbox", None), w, h)
                pos = getattr(lbox, "position", order_idx)
                label = str(getattr(lbox, "label", "Text") or "Text")
                overlapping_lines = [
                    ln["text"]
                    for ln in lines_out
                    if not (
                        ln["bbox"]["x1"] < bbox["x0"]
                        or ln["bbox"]["x0"] > bbox["x1"]
                        or ln["bbox"]["y1"] < bbox["y0"]
                        or ln["bbox"]["y0"] > bbox["y1"]
                    )
                ]
                blocks_out.append({
                    "order": int(pos) if isinstance(pos, int) else order_idx,
                    "label": label,
                    "text": "\n".join(overlapping_lines).strip(),
                    "confidence": round(sum(confidences) / len(confidences), 2) if confidences else 88.0,
                    "bbox": bbox,
                })
            blocks_out.sort(key=lambda b: b["order"])

            tables_out: List[Dict[str, Any]] = []
            if tbl_obj is not None and hasattr(tbl_obj, "cells"):
                row_map: Dict[int, List[tuple]] = {}
                for cell in getattr(tbl_obj, "cells", []) or []:
                    r_id = int(getattr(cell, "row_id", 0) or 0)
                    c_id = int(getattr(cell, "col_id", 0) or 0)
                    txt = str(getattr(cell, "text", "") or "").strip()
                    row_map.setdefault(r_id, []).append((c_id, txt))
                ordered_rows = [
                    [t for _, t in sorted(row_map[r_key], key=lambda pair: pair[0])]
                    for r_key in sorted(row_map.keys())
                ]
                if ordered_rows:
                    tables_out.append({
                        "headers": ordered_rows[0],
                        "rows": ordered_rows[1:],
                    })

            page_text = "\n".join(ln["text"] for ln in lines_out).strip()
            avg_conf = round(sum(confidences) / len(confidences), 2) if confidences else 0.0
            pages_out.append({
                "pageNumber": start_page_number + idx,
                "width": w,
                "height": h,
                "text": page_text,
                "confidence": avg_conf,
                "blocks": blocks_out,
                "lines": lines_out,
                "equations": [],
                "tables": tables_out,
            })

    return {
        "ok": True,
        "engine": "surya",
        "apiMode": runtime.api_mode,
        "device": runtime.device,
        "languagesRequested": languages or ["en"],
        "durationMs": int((time.perf_counter() - t0) * 1000),
        "pages": pages_out,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    surya_installed = False
    try:
        import surya  # noqa: F401
        surya_installed = True
    except Exception:
        pass
    return {
        "ok": True,
        "service": "pqguide-surya-service",
        "suryaInstalled": surya_installed,
        "suryaLoaded": runtime.rec_predictor is not None,
        "apiMode": runtime.api_mode,
        "device": runtime.detect_device(),
        "htrEnabled": ENABLE_TROCR,
        "htrModel": TROCR_MODEL_ID,
        "htrLoaded": runtime.htr_model is not None,
        "loadError": runtime.load_error,
        "htrError": runtime.htr_error,
    }


@app.post("/analyze")
@app.post("/ocr")
async def analyze_endpoint(
    payload: Optional[Base64AnalyzeRequest] = None,
    file: Optional[UploadFile] = File(default=None),
    pageNumber: int = Form(default=1),
) -> JSONResponse:
    try:
        if file is not None:
            raw = await file.read()
            if not raw or len(raw) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=413, detail="Uploaded file empty or too large.")
            images = _rasterize_bytes(raw, file.content_type)
            result = _analyze_pages(images, start_page_number=pageNumber)
            return JSONResponse(result)

        if payload is not None and payload.imageBase64:
            raw = _decode_base64_payload(payload.imageBase64)
            images = _rasterize_bytes(raw, payload.mimeType)
            result = _analyze_pages(
                images,
                start_page_number=payload.pageNumber,
                languages=payload.languages,
            )
            return JSONResponse(result)

        raise HTTPException(status_code=400, detail="Provide either multipart `file` or JSON `imageBase64`.")
    except RuntimeError as exc:
        return JSONResponse({"ok": False, "error": str(exc)}, status_code=503)


@app.post("/htr")
def htr_endpoint(req: Base64HtrRequest) -> JSONResponse:
    raw = _decode_base64_payload(req.imageBase64)
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    if not runtime.ensure_htr():
        return JSONResponse(
            {"ok": False, "modelAvailable": False, "error": runtime.htr_error or "HTR model unavailable."},
            status_code=503,
        )

    import torch

    pixel_values = runtime.htr_processor(images=img, return_tensors="pt").pixel_values.to(runtime.device)
    with torch.no_grad():
        outputs = runtime.htr_model.generate(
            pixel_values,
            max_new_tokens=96,
            return_dict_in_generate=True,
            output_scores=True,
        )
    text = runtime.htr_processor.batch_decode(outputs.sequences, skip_special_tokens=True)[0].strip()

    # Estimate mean token probability honestly from generation scores
    confidence = 0.0
    if outputs.scores:
        probs: List[float] = []
        for step_logits in outputs.scores:
            step_probs = torch.softmax(step_logits[0], dim=-1)
            probs.append(float(step_probs.max().item()))
        if probs:
            confidence = round((sum(probs) / len(probs)) * 100.0, 2)

    unreadable = len(text) == 0 or confidence < 38.0
    return JSONResponse({
        "ok": True,
        "modelAvailable": True,
        "model": TROCR_MODEL_ID,
        "text": text if not unreadable else "[unreadable handwriting]",
        "rawCandidate": text,
        "confidence": confidence,
        "unreadable": unreadable,
    })
