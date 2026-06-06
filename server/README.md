# Bill Reminder — Server (Python)

This is the small API that reads bill photos using Claude. The phone app calls it.

## Run it locally (for testing on your phone over Wi-Fi)

```bash
cd server
python3 -m venv venv          # create an isolated Python environment
source venv/bin/activate      # turn it on  (you'll see "(venv)" in the prompt)
pip install -r requirements.txt

cp .env.example .env          # then open .env and paste your real Anthropic key
uvicorn main:app --host 0.0.0.0 --port 8000
```

Check it works:

```bash
curl http://localhost:8000/health
# -> {"status":"ok","model":"claude-sonnet-4-6"}
```

Your phone (on the same Wi-Fi) reaches it at:  **http://YOUR-MAC-IP:8000**

## Endpoints

| Method | Path      | What it does                                              |
|--------|-----------|----------------------------------------------------------|
| GET    | `/health` | Quick "is it alive?" check                                |
| POST   | `/scan`   | Body: `{ "image": "<base64>", "mime_type": "image/jpeg" }` → returns the extracted action item |

## To put it on Oracle Cloud (free, always-on)

See [DEPLOY_ORACLE.md](./DEPLOY_ORACLE.md).
