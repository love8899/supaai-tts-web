# SupaAI TTS — Azure Deployment Handoff
**Date:** 2026-10-11  
**Status:** Application and MP3 generation tested successfully. Auto-start enabled; actual reboot recovery and Cloudflare origin mapping still to verify.

## 1. Architecture

```text
Browser -> https://tts.supaai.cloud -> Cloudflare (verify tunnel/DNS mode)
  -> Azure stt-vm :3000 -> Next.js 16.1.6 / PM2 supaai-tts-web
      -> POST /api/tts -> Google reCAPTCHA verification
      -> http://127.0.0.1:8000/tts -> FastAPI / systemd supaai-tts
          -> Azure Speech SDK -> in-memory MP3 bytes
      <- audio/mpeg -> browser Blob URL, playback, MP3 download
```

Frontend and backend run on the same Azure VM. Backend is bound to **127.0.0.1:8000** and must never be opened publicly. The frontend was observed listening on ***:3000**. If using Cloudflare Tunnel on this VM, point its origin to `http://127.0.0.1:3000` and preferably bind frontend to loopback; neither 3000 nor 8000 needs an inbound NSG rule. If using Cloudflare DNS proxy instead, verify supported origin port and HTTPS/reverse-proxy arrangement. The actual Cloudflare route was not independently inspected; do not assume the public hostname has been migrated merely because localhost works.

## 2. Servers, repositories, paths

| Role | Source | Azure path | Runtime |
|---|---|---|---|
| Frontend | https://github.com/love8899/supaai-tts-web | /opt/supaai/supaai-tts-web | Next.js, Node 22, PM2 |
| Backend | https://github.com/love8899/tts | /opt/supaai/tts | Python 3.12, FastAPI, Uvicorn, systemd |

Baseline commits: frontend `0d06105`; backend `6f0d07f`, branch `main`. They are **separate Git repositories**. This handoff is stored in frontend `doc/`.

New VM: Ubuntu 24.04.5 LTS, Azure Canada Central, hostname `stt-vm`, login `azureuser`, DNS label `stt.canadacentral.cloudapp.azure.com`, IP observed `20.220.188.62` (verify current/static status). Source preparation workstation: PC001 `D:\project\TTS\`.

Original server for rollback: `ubuntu@192.168.70.32`, frontend `/home/ubuntu/supaai-tts-web`, backend `/home/ubuntu/tts`. Preserve until public cutover and reboot validation are complete.

## 3. Code architecture and API

- `supaai-tts-web/app/page.tsx`: UI for text/voice/speed, POST to `/api/tts`, browser Blob URL for playback and download; revokes previous Blob URLs.
- `supaai-tts-web/app/api/tts/route.ts`: Node runtime, checks reCAPTCHA token against Google; default minimum score 0.5, action `tts_generate`, expected host `tts.supaai.cloud`; POST proxy to `TTS_BACKEND_URL/tts`; returns `audio/mpeg` with `no-store`.
- `tts/app.py`: FastAPI routes `GET /`, `GET /health`, `GET /docs`, `POST /tts`, optional `GET /tts`. JSON `{"text":"Hello","voice":"en-US-JennyNeural","rate":"0%"}` (text 1–5000 characters). Azure Speech SDK format `Audio16Khz128KBitRateMonoMp3`; audio generated **in memory**, no normal server-side MP3 file storage.
- `tts/tts_mp3.py` is a standalone test script that writes `output.mp3`; not part of the web API.
- **Known code caveat:** frontend sends `{text, voice, speed}` but backend expects `{text, voice, rate}`; backend may use default `rate="0%"` for all requests. Follow up with a mapping fix and test non-default speeds. MP3 generation itself was tested.

## 4. Environment and secrets

Never commit actual credentials or paste them in logs/tickets. Files must be owned by `azureuser` with `chmod 600`. `.env.local` must exist **before frontend build** because `NEXT_PUBLIC_` variables are embedded in client assets.

Backend `/opt/supaai/tts/.env`:
```dotenv
AZURE_SPEECH_KEY=<secret>
AZURE_SPEECH_REGION=<region>
```
Frontend `/opt/supaai/supaai-tts-web/.env.local`:
```dotenv
TTS_BACKEND_URL=http://127.0.0.1:8000
NEXT_PUBLIC_RECAPTCHA_SITE_KEY=<site-key>
RECAPTCHA_SECRET_KEY=<secret>
RECAPTCHA_MIN_SCORE=0.5
RECAPTCHA_EXPECTED_HOST=tts.supaai.cloud
```
Last two frontend settings have code defaults; explicit values are optional. Python `load_dotenv()` reads backend credentials at startup.

**Migration incident:** copied old frontend env had `TTS_BACKEND_URL=http://192.168.70.32:8000`; the Azure frontend returned `{"error":"Proxy error","detail":"fetch failed"}`. Both local servers were healthy; changing backend URL to `http://127.0.0.1:8000` and restarting PM2 resolved the problem. **Port 8000 does not need an Azure inbound rule.**

## 5. Clean deployment procedure (Ubuntu 24.04)

### Prerequisites
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential python3-venv python3-pip
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
sudo -E bash /tmp/nodesource_setup.sh
sudo apt install -y nodejs
sudo npm install -g pm2
node -v; npm -v; python3 --version; pm2 -v
```
Review third-party install scripts before execution. Ensure outbound HTTPS access to Azure Speech, Google reCAPTCHA and GitHub.

### Clone both repos as azureuser
```bash
sudo mkdir -p /opt/supaai
sudo chown azureuser:azureuser /opt/supaai
cd /opt/supaai
git clone https://github.com/love8899/supaai-tts-web.git
git clone https://github.com/love8899/tts.git
```
Avoid `sudo git clone` into root-owned `/opt`.

### Backend dependencies
```bash
cd /opt/supaai/tts
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/pip install -r requirements.txt
.venv/bin/python -c "import fastapi, uvicorn, azure.cognitiveservices.speech; print('Backend dependencies OK')"
```
Transfer secrets securely (SCP or approved secret store) from original server or provision new credentials; `chmod 600` both env files. Do not print actual secret values. Set `TTS_BACKEND_URL` to loopback.

### Frontend build
```bash
cd /opt/supaai/supaai-tts-web
npm ci
npm run build
```
Build previously passed on Next.js 16.1.6 with routes `/` and `/api/tts`.

### Backend systemd
Create `/etc/systemd/system/supaai-tts.service`:
```ini
[Unit]
Description=SupaAI TTS FastAPI Backend
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=azureuser
Group=azureuser
WorkingDirectory=/opt/supaai/tts
Environment=PYTHONUNBUFFERED=1
Environment=PATH=/opt/supaai/tts/.venv/bin:/usr/bin:/bin
ExecStart=/opt/supaai/tts/.venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now supaai-tts
sudo systemctl status supaai-tts --no-pager
curl -fsS http://127.0.0.1:8000/health
```

### Frontend PM2
```bash
cd /opt/supaai/supaai-tts-web
pm2 start npm --name supaai-tts-web -- start
pm2 save
pm2 startup systemd -u azureuser --hp /home/azureuser
# Execute the sudo command printed by PM2, if provided.
systemctl is-enabled pm2-azureuser
```
Default start listens on port 3000. For a locally installed Cloudflare Tunnel, prefer `pm2 start npm --name supaai-tts-web -- start -- -H 127.0.0.1 -p 3000` (after stopping prior process), then `pm2 save`.

### Cloudflare / network
Publish `tts.supaai.cloud` to the intended Azure frontend origin. For a Cloudflare Tunnel on this VM, use `http://127.0.0.1:3000`. For direct DNS/proxy, verify supported port, TLS termination and firewall configuration; consider HTTPS reverse proxy on 443. Keep backend port 8000 private. Restrict SSH port 22 to approved IPs. Do not change live DNS until Azure end-to-end validation and rollback planning are complete.

## 6. Health checks and acceptance

```bash
pm2 list
sudo systemctl is-active supaai-tts
systemctl is-enabled supaai-tts
systemctl is-enabled pm2-azureuser
sudo ss -lntp | grep -E ':3000|:8000'
curl -I http://127.0.0.1:3000
curl -fsS http://127.0.0.1:8000/health
grep '^TTS_BACKEND_URL=' /opt/supaai/supaai-tts-web/.env.local
```
Expected: PM2 online, systemd active, both enabled, frontend HTTP 200, backend `{"status":"ok"}`, backend URL localhost. Browser test: visit published hostname, pass reCAPTCHA, generate MP3, play and download. MP3 generation/playback was confirmed by user on 2026-10-11. Confirm public hostname routes to new VM separately.

Auto-start checks completed: `systemctl is-enabled supaai-tts` = `enabled`, `systemctl is-enabled pm2-azureuser` = `enabled`, `pm2 save` saved `/home/azureuser/.pm2/dump.pm2`. Actual reboot validation still pending.

## 7. Day-2 operations

**Logs:**
```bash
sudo journalctl -u supaai-tts -n 100 --no-pager
pm2 logs supaai-tts-web --lines 100 --nostream
pm2 list
df -h
```

**Update frontend:**
```bash
cd /opt/supaai/supaai-tts-web
git status --short
git pull --ff-only origin main
npm ci
npm run build
pm2 restart supaai-tts-web
pm2 save
```

**Update backend:**
```bash
cd /opt/supaai/tts
git status --short
git pull --ff-only origin main
.venv/bin/pip install -r requirements.txt
sudo systemctl restart supaai-tts
curl -fsS http://127.0.0.1:8000/health
```
Review `git status` before pulling; do not overwrite local changes or env files. For rollback, restore a known-good commit, rebuild/restart affected service; retain original Ubuntu server until final cutover and recovery tests.

**Planned reboot test:**
```bash
sudo reboot
# reconnect:
systemctl is-active supaai-tts
systemctl is-active pm2-azureuser
pm2 list
curl -I http://127.0.0.1:3000
curl -fsS http://127.0.0.1:8000/health
```

## 8. MP3 retention investigation

Normal web synthesis returns MP3 bytes in memory; no persistent output folder is used. Old Ubuntu scan of `/home/ubuntu/tts` and `/home/ubuntu/supaai-tts-web` (excluding venv and node_modules) found **3 MP3 files, 0.35 MB total** (2 backend, 1 frontend). No MP3 cleanup timer is required for the current architecture. If persistent storage is added later, implement scoped retention and a timer after identifying generated-output paths.

## 9. Remaining follow-ups

1. Verify Cloudflare routing mode and confirm the live hostname's actual origin is Azure.
2. Perform a controlled reboot and validate both services recover.
3. Correct frontend `speed` vs backend `rate` mismatch; test non-default rates.
4. Remove temporary workstation copies of secret env files when safe.
5. Review VM monitoring, updates, SSH restrictions, backup, and secret rotation.

**End of handoff.**
