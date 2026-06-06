"""
Bill Reminder API
=================
A tiny proxy server. The phone app sends it a photo of a bill/receipt/report;
this server asks Claude to read it and return a clean, structured action item,
then sends that back to the app.

The Anthropic API key lives ONLY here (in the .env file), never in the app.

Run locally:
    cp .env.example .env          # then paste your key into .env
    pip install -r requirements.txt
    uvicorn main:app --host 0.0.0.0 --port 8000

Then test:  curl http://localhost:8000/health
"""

import json
from datetime import date, timedelta

from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).with_name(".env"))  # read ANTHROPIC_API_KEY, MODEL, MOCK from server/.env

import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import anthropic

MODEL = os.environ.get("MODEL", "claude-sonnet-4-6")

# MOCK mode: when ON, the server returns a fixed fake "AI" answer and does NOT
# call Claude — handy while you don't have a working API token.
# Turn it off later: set MOCK=false in .env and add a real ANTHROPIC_API_KEY.
MOCK = os.environ.get("MOCK", "false").lower() in ("1", "true", "yes")

# The Anthropic client is created only when we actually need it (real mode),
# so the server still runs in MOCK mode even with no API key set.
_client = None


def get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic()
    return _client

app = FastAPI(title="Bill Reminder API")

# Allow the phone app to call this server from anywhere.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScanRequest(BaseModel):
    image: str                       # the photo, base64-encoded (no "data:" prefix)
    mime_type: str = "image/jpeg"    # "image/jpeg" or "image/png"


# We force Claude to answer in exactly this shape, so the app always gets clean data.
RESPONSE_SCHEMA = {
    "type": "object",
    "properties": {
        "found_document": {"type": "boolean"},
        "item": {"type": "string"},
        "category": {
            "type": "string",
            "enum": [
                "bike_service", "vehicle_service", "health_checkup",
                "return_window", "warranty", "insurance",
                "subscription", "bill_payment", "other",
            ],
        },
        "vendor": {"type": ["string", "null"]},
        "document_date": {"type": ["string", "null"]},
        "action_label": {"type": "string"},
        "action_date": {"type": ["string", "null"]},
        "reasoning": {"type": "string"},
        "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
    },
    "required": [
        "found_document", "item", "category", "vendor", "document_date",
        "action_label", "action_date", "reasoning", "confidence",
    ],
    "additionalProperties": False,
}


def build_prompt(today: str) -> str:
    return f"""You are the brain of a reminder app. The user has photographed a \
bill, receipt, report, or document. Today's date is {today}.

Your job: find the ONE most useful future action and the date it should happen, \
so the app can remind the user 2 days before.

Fill in every field:
- found_document: true if the image is a readable bill/receipt/report/document; \
false if it is blurry, unrelated, or clearly not a document.
- item: short description of what this is about \
(e.g. "Trek FX 3 bicycle service", "Annual health check-up", "Amazon order - running shoes").
- category: the best-matching category.
- vendor: the business or issuer name, or null if not visible.
- document_date: the main date printed on the document (purchase/service/issue date) \
as YYYY-MM-DD, or null if not visible.
- action_label: what the user should do \
(e.g. "Next bike service due", "Return window closes", "Policy renewal due", "Warranty expires").
- action_date: the FUTURE date the reminder is about, as YYYY-MM-DD.
    * If the document prints an explicit due / expiry / return-by date, use it.
    * Otherwise infer a sensible interval from the document type \
(bike service ~ every 6 months, car service ~ 1 year, health check-up ~ 1 year, \
Amazon return ~ the printed return window or about 10 days after delivery).
    * action_date MUST be after today ({today}). If you truly cannot determine \
any future date, use null.
- reasoning: one short sentence explaining how you chose action_date.
- confidence: your overall confidence (high / medium / low).

Rules:
- Use ISO dates (YYYY-MM-DD) only.
- Do not invent a vendor or a date that the image and a reasonable interval do not support.
"""


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL, "mock": MOCK}


@app.post("/scan")
def scan(req: ScanRequest):
    today = date.today()

    # ---- MOCK mode: return a fixed answer without calling the AI ----
    if MOCK:
        return {
            "found_document": True,
            "item": "Trek FX 3 bicycle service",
            "category": "bike_service",
            "vendor": "City Cycle Works",
            "document_date": today.isoformat(),
            "action_label": "Next bike service due",
            "action_date": (today + timedelta(days=180)).isoformat(),
            "reasoning": "MOCK response (no AI token yet) - bikes are usually serviced every 6 months.",
            "confidence": "high",
        }

    # ---- Real mode: ask Claude to read the bill ----
    try:
        response = get_client().messages.create(
            model=MODEL,
            max_tokens=1024,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": req.mime_type,
                            "data": req.image,
                        },
                    },
                    {"type": "text", "text": build_prompt(today.isoformat())},
                ],
            }],
            output_config={"format": {"type": "json_schema", "schema": RESPONSE_SCHEMA}},
        )
    except anthropic.APIError as e:
        raise HTTPException(status_code=502, detail=f"AI request failed: {e}")

    text = next((b.text for b in response.content if b.type == "text"), None)
    if not text:
        raise HTTPException(status_code=502, detail="AI returned no text")

    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="AI returned invalid JSON")

    return data
