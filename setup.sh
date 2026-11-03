#!/usr/bin/env bash
# One-time setup: Python venv for the pipeline, npm deps for the UI, .env.
#   ./setup.sh && (cd loomv2 && npm run dev)
set -euo pipefail
cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "✗ $1 not found — $2"; exit 1; }; }
need ffmpeg  "install it (brew install ffmpeg / sudo apt install ffmpeg)"
need ffprobe "it ships with ffmpeg"
need node    "install Node.js 20+"
need npm     "it ships with Node.js"

PY=${PYTHON:-python3}
need "$PY" "install Python 3.10+"
"$PY" -c 'import sys; sys.exit(0 if sys.version_info >= (3, 10) else 1)' \
  || { echo "✗ Python 3.10+ required ($("$PY" --version))"; exit 1; }

echo "→ Python venv (scripts/.venv)"
[ -d scripts/.venv ] || "$PY" -m venv scripts/.venv
scripts/.venv/bin/pip install -q --upgrade pip
scripts/.venv/bin/pip install -q -r scripts/requirements.txt

echo "→ Checking text shaping and OCR models"
(cd scripts && .venv/bin/python -m unittest -q test_pipeline)

echo "→ npm install (loomv2)"
(cd loomv2 && npm install --no-audit --no-fund --loglevel=error)

if [ ! -f .env ]; then
  cp .env.example .env
  echo "→ Created .env — add your SARVAM_API_KEY (and OPENAI_API_KEY for AI mode)"
fi

# Signs login sessions; required by `npm run start:public`
if ! grep -qE '^SESSION_SECRET=.{32,}' .env; then
  secret=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")
  if grep -qE '^#? *SESSION_SECRET=' .env; then
    sed -i.bak -E "s|^#? *SESSION_SECRET=.*|SESSION_SECRET=${secret}|" .env && rm -f .env.bak
  else
    printf '\nSESSION_SECRET=%s\n' "$secret" >> .env
  fi
  echo "→ Generated SESSION_SECRET in .env"
fi

echo "✓ Ready. Start the UI with: cd loomv2 && npm run dev"
