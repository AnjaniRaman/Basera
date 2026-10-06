// Runtime configuration from environment variables (see .env.example).
const bool = (v, dflt = false) => (v === undefined || v === '' ? dflt : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const int = (v, dflt) => (v === undefined || v === '' ? dflt : Number.parseInt(v, 10));

export function loadConfig(overrides = {}) {
  const env = { ...process.env, ...overrides };
  const production = (env.NODE_ENV || 'development') === 'production';
  return {
    production,
    port: int(env.PORT, 4000),
    host: env.HOST || '0.0.0.0',
    databaseUrl: env.DATABASE_URL || '',
    dataDir: env.DATA_DIR || './data/pglite',
    corsOrigin: env.CORS_ORIGIN || '*',
    trustProxy: bool(env.TRUST_PROXY, false),
    serveFrontend: bool(env.SERVE_FRONTEND, true),
    sessionDays: int(env.SESSION_DAYS, 90),
    // A fixed OTP for development. Ignored in production unless ALLOW_DEV_OTP=1 (never do that on a real deployment).
    devOtp: !production || bool(env.ALLOW_DEV_OTP, false) ? env.AUTH_DEV_OTP || '' : '',
    otp: {
      provider: env.OTP_PROVIDER || 'console',
      msg91: { authKey: env.MSG91_AUTH_KEY || '', templateId: env.MSG91_TEMPLATE_ID || '', sender: env.MSG91_SENDER || '' },
      twilio: { sid: env.TWILIO_ACCOUNT_SID || '', token: env.TWILIO_AUTH_TOKEN || '', from: env.TWILIO_FROM || '' },
      webhook: { url: env.OTP_WEBHOOK_URL || '', secret: env.OTP_WEBHOOK_SECRET || '' }
    },
    maxUploadBytes: int(env.MAX_UPLOAD_BYTES, 5 * 1024 * 1024),
    appName: env.APP_NAME || 'Basera'
  };
}
