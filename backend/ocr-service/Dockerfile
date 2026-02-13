FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

COPY backend/ocr-service/requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt

COPY backend/ocr-service/app.py /app/app.py

EXPOSE 7001

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7001"]
