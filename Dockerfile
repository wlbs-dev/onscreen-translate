# syntax=docker/dockerfile:1
# Single-container deploy: Next.js UI + Python pipeline (PaddleOCR, Playwright, ffmpeg).
#   docker build -t onscreen-translate .
#   docker run -p 3000:3000 -v ot-data:/data --env-file .env onscreen-translate

# ── Build the web app ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS web
WORKDIR /app/loomv2
COPY loomv2/package.json loomv2/package-lock.json ./
RUN npm ci
COPY loomv2/ ./
RUN npm run build

# ── Runtime ───────────────────────────────────────────────────────────────────
FROM python:3.11-slim-bookworm
ENV PYTHONUNBUFFERED=1 \
    NODE_ENV=production \
    WORKSPACE_DIR=/data \
    SCRIPTS_DIR=/app/scripts \
    PYTHON=python \
    PORT=3000

RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg libgl1 libglib2.0-0 libgomp1 ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY --from=web /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY scripts/requirements.txt scripts/requirements.txt
RUN pip install --no-cache-dir -r scripts/requirements.txt \
 && playwright install --with-deps chromium

COPY scripts/ scripts/
# Download the PaddleOCR English models at build time so jobs don't need
# network access to the model CDN at runtime
RUN cd scripts && python -c "from paddleocr import PaddleOCR; PaddleOCR(lang='en', use_angle_cls=False, use_gpu=False, show_log=False)"

COPY --from=web /app/loomv2 /app/loomv2

VOLUME /data
EXPOSE 3000
WORKDIR /app/loomv2
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "bin/start-public.mjs"]
