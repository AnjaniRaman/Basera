# Deploying Basera

The whole product is one container: the API serves the web app and talks to PostgreSQL. Everything below takes about 20 minutes and needs two accounts, both free to start.

## 1. Hosting: Render (free tier)

1. Go to https://render.com and sign up with GitHub (the AnjaniRaman account).
2. Open **https://render.com/deploy?repo=https://github.com/AnjaniRaman/Basera** and click **Apply**. Render reads `render.yaml` and creates:
   - `basera`: the web service (API + app), Singapore region, HTTPS on `https://basera-xxxx.onrender.com`.
   - `basera-db`: a PostgreSQL database, wired in through `DATABASE_URL`.
3. Wait for the first deploy (5–8 minutes). Open the URL; the welcome screen should appear and **Online account** should be offered.

The free web service sleeps after 15 minutes without traffic and wakes in ~30 s; the free database is deleted after 90 days unless upgraded. For a PG in daily use, pick the **Starter** plan for both ($7 + $7 per month) before going live.

## 2. SMS codes: MSG91

Sign-in codes are printed to the Render log until an SMS provider is set.

1. Sign up at https://msg91.com, complete KYC (needed in India for transactional SMS), and create an **OTP template** with the variable `##OTP##`. Approval usually takes a day.
2. In Render → `basera` → **Environment**, set `OTP_PROVIDER=msg91`, `MSG91_AUTH_KEY`, `MSG91_TEMPLATE_ID`, `MSG91_SENDER` (your 6-letter sender ID). Save; Render redeploys.

Twilio works the same way (`OTP_PROVIDER=twilio`, `TWILIO_*`), as does your own gateway (`OTP_PROVIDER=webhook`).

## 3. Point the apps at your server

In GitHub → **Settings → Secrets and variables → Actions → Variables**, add `APP_API_URL` = `https://basera-xxxx.onrender.com/api`. The next push builds an Android APK and a Windows installer that use your server (Actions tab → latest run → Artifacts). Without it, the apps run in device-only mode.

## 4. Your own domain (optional)

Render → `basera` → **Settings → Custom domains** → add `app.yourdomain.in` and create the CNAME it shows at your registrar. HTTPS is automatic. Then set `CORS_ORIGIN=https://app.yourdomain.in` to stop other websites calling your API from a browser (the mobile apps are unaffected).

## 5. Before going live

- `AUTH_DEV_OTP` and `ALLOW_DEV_OTP` must not be set on the server.
- Turn on database backups (Render Starter plan: daily, automatic). Owners can also back up from Settings.
- Read `SECURITY.md` once.

## Running elsewhere

`docker compose up --build` with `POSTGRES_PASSWORD` set runs the same stack on any VPS (Hetzner, DigitalOcean, AWS Lightsail). Put Caddy or nginx in front for HTTPS and set `TRUST_PROXY=1`.
