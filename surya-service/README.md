# PQGuide Surya OCR & HTR Microservice

Dedicated Python inference sidecar wrapping **`datalab-to/surya`** (`RecognitionPredictor`, `LayoutPredictor`, `TableRecPredictor`) and optional **`microsoft/trocr-base-handwritten`** for cropped handwritten lines.

## Why a Sidecar?
Surya executes neural vision/layout models (~650M–689M parameter VLM + table/layout predictors) that require PyTorch + `vllm` or `llama-server`. Running it as an isolated service prevents browser OOM crashes and keeps PQGuide's Node/Express container lightweight while preserving Tesseract.js as local fallback.

## Running Locally (CPU or NVIDIA GPU)

```bash
cd surya-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8000
```

Then configure PQGuide backend `.env`:
```env
SURYA_OCR_URL=http://127.0.0.1:8000
HTR_SERVICE_URL=http://127.0.0.1:8000/htr
```

## Hardware Recommendations
- **GPU (Recommended)**: NVIDIA T4 or L4 (16–24 GB VRAM) — ~0.4–1.5s/page.
- **CPU (Low Volume)**: 4–8 vCPUs, 16 GB RAM minimum — ~4–15s/page.
- Not suitable inside a 4 GiB RAM Node web container without swap/GPU.
