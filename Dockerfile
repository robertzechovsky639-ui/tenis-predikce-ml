# Hugging Face Spaces (Docker) / Render / Fly.io. Data se stáhnou a model natrénuje při buildu (~5 min, ~4 GB RAM).
FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 && rm -rf /var/lib/apt/lists/*
RUN useradd -m -u 1000 user
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY --chown=user . .
USER user
RUN python scripts/download_data.py \
 && cd backend && python train.py && python export_matches.py \
 && rm -rf /app/data/raw
ENV PORT=7860 TENIS_LIVE_POLL=3
EXPOSE 7860
WORKDIR /app/backend
CMD ["sh", "-c", "uvicorn app:app --host 0.0.0.0 --port ${PORT}"]
