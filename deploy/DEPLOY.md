# Hosting Aetheris 24/7 on your own server

## What you need
1. A VPS running **Ubuntu 22.04 or 24.04** (any provider — Hetzner, DigitalOcean,
   Contabo — smallest size is plenty).
2. Your `.me` domain's DNS access (wherever the domain lives).
3. This repo + your secret values from your local `.env.local`
   (never committed — copy them by hand onto the server).

## Steps
1. **SSH into the VPS** as root.
2. **Run the setup script** (replace with nothing — the URL is already correct):
   ```bash
   curl -fsSL https://raw.githubusercontent.com/AlexPlaysMusic/aetheris-support-ai/main/deploy/setup-server.sh -o setup-server.sh
   bash setup-server.sh https://github.com/AlexPlaysMusic/aetheris-support-ai.git
   ```
   The script stops before starting and tells you to fill in `.env.local`.
3. **Fill in secrets** on the server:
   ```bash
   nano /opt/aetheris/.env.local
   ```
   Copy every value from your PC's `.env.local`. Set:
   `NEXTAUTH_URL=https://your-domain.me` (your real domain, https).
4. **Re-run the script** — it finishes the build and starts the app with PM2.
   Check: `pm2 list` should show `aetheris` online.
5. **Point the domain at the server**: in your domain's DNS settings add an
   **A record**: host `@`, value `<your VPS IP address>`. Wait a few minutes.
6. **Install the nginx proxy** (file `deploy/nginx-aetheris.conf` in this repo):
   ```bash
   sudo cp deploy/nginx-aetheris.conf /etc/nginx/sites-available/aetheris
   sudo sed -i 's/your-domain.me/YOUR-REAL-DOMAIN/' /etc/nginx/sites-available/aetheris
   sudo ln -s /etc/nginx/sites-available/aetheris /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   ```
7. **HTTPS** (required for Google login in production):
   ```bash
   sudo certbot --nginx -d YOUR-REAL-DOMAIN
   ```
8. **Google OAuth redirect**: in
   https://console.cloud.google.com/apis/credentials open your OAuth client
   and add `https://YOUR-REAL-DOMAIN/api/auth/callback/google` to the
   authorized redirect URIs.

## Updating later
```bash
cd /opt/aetheris && git pull && npm ci --no-audit --no-fund && npm run build && pm2 restart aetheris
```

## Useful commands (on the server)
- `pm2 list` / `pm2 logs aetheris` / `pm2 restart aetheris`
- `sudo systemctl status nginx`
