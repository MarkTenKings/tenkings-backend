# Variant Corner Service

Fast corner detection + warp for card images.

## Endpoint
`POST /normalize`

Body:
```json
{
  "imageUrl": "https://..." ,
  "imageBase64": "..."  // optional
}
```

Response:
```json
{
  "normalizedBase64": "...",
  "width": 800,
  "height": 1100,
  "method": "perspective" | "bbox",
  "corners": [[x1,y1],[x2,y2],[x3,y3],[x4,y4]]
}
```

## Run locally
```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8090
```

## Env
- `VARIANT_CORNER_TARGET_W` (default 800)
- `VARIANT_CORNER_TARGET_H` (default 1100)

## Integration
Set in bytebot-lite-service:
```
VARIANT_CORNER_URL=http://<host>:8090/normalize
```
