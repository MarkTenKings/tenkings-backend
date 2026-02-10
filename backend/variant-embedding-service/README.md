# Variant Embedding Service (DINOv2)

Generates image embeddings for card crops using DINOv2.

## Endpoint
`POST /embed`

Body:
```json
{
  "imageUrl": "https://...",
  "imageBase64": "..." // optional
}
```

Response:
```json
{
  "cropUrls": [],
  "embeddings": [
    {"cropUrl": "crop:top", "vector": [..]}
  ]
}
```

## Run locally
```bash
python -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --host 0.0.0.0 --port 8091
```

## Env
- `VARIANT_DINOV2_MODEL` (default `dinov2_vits14`)
- `VARIANT_EMBEDDING_DEVICE` (default `cpu`, set to `cuda` for GPU)

## Integration
Set in app env:
```
VARIANT_EMBEDDING_URL=http://<host>:8091/embed
```
