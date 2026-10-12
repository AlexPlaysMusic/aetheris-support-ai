#!/usr/bin/env bash
# Aetheris server setup — run ONCE on a fresh Ubuntu 22.04/24.04 VPS as root.
# Usage:  bash setup-server.sh <github-repo-url>
# Example: bash setup-server.sh https://github.com/AlexPlaysMusic/aetheris-support-ai.git
set -euo pipefail

REPO_URL="${1:?Pass the repo URL: bash setup-server.sh <repo-url>}"
APP_DIR="/opt/aetheris"

echo "==> System packages"
apt-get update -y
apt-get install -y curl git nginx certbot python3-certbot-nginx

echo "==> Node.js 20"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "==> PM2"
npm install -g pm2 --no-audit --no-fund

echo "==> App code"
if [ ! -d "$APP_DIR/.git" ]; then
  git clone "$REPO_URL" "$APP_DIR"
else
  git -C "$APP_DIR" pull --ff-only
fi
cd "$APP_DIR"

echo "==> Dependencies + build"
npm ci --no-audit --no-fund
npm run build

echo "==> Environment"
if [ ! -f "$APP_DIR/.env.local" ]; then
  cp .env.local.example .env.local
  echo "!!! Edit $APP_DIR/.env.local with your REAL secrets, then continue."
  echo "    Required: LLM_PROVIDER, GOOGLE_GENERATIVE_AI_API_KEY,"
  echo "    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, NEXTAUTH_SECRET,"
  echo "    NEXTAUTH_URL=https://<YOUR-DOMAIN>"
  exit 1
fi

echo "==> Start with PM2"
pm2 delete aetheris 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo "==> Done. App is on http://<server-ip>:3000"
echo "    Next: point your domain at this server (DNS A record),"
echo "    install the nginx file from deploy/, then run certbot for HTTPS."
