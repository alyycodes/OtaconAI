#!/usr/bin/env bash
# OtaconAI launcher for macOS and Linux.
set -e
cd "$(dirname "$0")"

[ -f backend/.env ] || { echo "backend/.env is missing. Add GEMINI_API_KEY=your-key"; exit 1; }

if [ ! -d backend/venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv backend/venv
fi

echo "Installing Python packages..."
backend/venv/bin/pip install --quiet --upgrade pip
backend/venv/bin/pip install --quiet -r backend/requirements.txt

if [ ! -d frontend/node_modules ]; then
  echo "Installing Node packages (first run takes a few minutes)..."
  (cd frontend && npm install --silent)
fi

# Stop both servers when this script is interrupted.
trap 'kill 0' EXIT INT TERM

(cd backend && ../backend/venv/bin/uvicorn main:app --reload --port 8000) &
sleep 3
(cd frontend && npm start) &

echo "Backend: http://127.0.0.1:8000/api/health"
echo "App:     http://localhost:3000"
wait
