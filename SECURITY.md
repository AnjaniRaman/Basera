# Security notes

What protects the data, and what an owner still has to do.

## Accounts and sessions
- Sign-in is by one-time code to the mobile number (10-minute validity, 5 attempts, 6 codes per hour per number) or by email and password. Passwords are hashed with scrypt; after 5 wrong tries an email is locked for 15 minutes.
- Forgotten password: a code to the registered phone resets it and signs every other device out. Settings → Security → **Sign out everywhere** does the same on demand (lost phone).
- Session tokens are random 256-bit values stored only as SHA-256 hashes; they expire after 90 days (`SESSION_DAYS`).
- Codes are never logged in production except with `OTP_PROVIDER=console`, which is for development.

## Who sees what
- Every command is checked on the server against the caller's role and access level, which are read from the stored property document, never from the request. Residents receive only their own bills, payments, requests and documents; staff receive their own work, or the books if the owner gave them Accounts desk or Manager access, but never other people's salaries. Settings, staff records, salaries and deleting payments are owner-only.
- Uploaded documents are served only to the owner, staff with access, or the person they belong to.
- Each change is written to an audit table (`events`) with who did it.

## Transport and headers
- HTTPS is terminated by the host (Render, or your reverse proxy); `TRUST_PROXY=1` lets rate limits see real client addresses. HSTS is sent in production.
- Helmet sets a strict Content-Security-Policy (own origin only), `X-Content-Type-Options`, `Referrer-Policy: no-referrer`, and denies framing.
- Rate limits: 10 OTP requests/hour, 15 password attempts/15 min, 10 password resets/hour, 60 auth calls/15 min, 300 API calls/min per IP. Request bodies are capped at 2 MB (JSON) and `MAX_UPLOAD_BYTES` (files).
- All input is validated with zod schemas shared with the app; SQL uses parameters only.

## Data at rest
- PostgreSQL on Render is encrypted at rest and reachable only from your Render services. Enable daily backups on a paid plan.
- Device-only mode keeps data in the browser's IndexedDB behind a per-person PIN (salted hash, 5 tries then a 5-minute lock, recovery code to reset). This is an app lock, not encryption: anyone with developer access to that browser profile could read the data. For a shared or public computer, use an online account.

## What the app never does
- Hold money. UPI payments go directly to the owner's UPI ID; the app only records the claim and the owner's confirmation.
- Store card or bank credentials.

## Reporting a problem
Open a private security advisory on the GitHub repository, or email the owner. Please do not file public issues for vulnerabilities.
