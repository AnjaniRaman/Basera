// SMS delivery for one-time codes. `console` prints the code to the server log (development),
// the others call a provider. All of them resolve once the message is handed over.

export function createOtpSender(config, log = console.log) {
  const { provider, msg91, twilio, webhook } = config.otp;

  async function sendConsole(phone, code) {
    log(`[otp] code for +91${phone}: ${code}`);
  }

  async function sendMsg91(phone, code) {
    if (!msg91.authKey || !msg91.templateId) throw new Error('MSG91_AUTH_KEY and MSG91_TEMPLATE_ID are required');
    const res = await fetch('https://control.msg91.com/api/v5/flow/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authkey: msg91.authKey },
      body: JSON.stringify({ template_id: msg91.templateId, sender: msg91.sender || undefined, recipients: [{ mobiles: `91${phone}`, otp: code }] })
    });
    if (!res.ok) throw new Error(`MSG91 responded ${res.status}`);
  }

  async function sendTwilio(phone, code) {
    if (!twilio.sid || !twilio.token || !twilio.from) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM are required');
    const body = new URLSearchParams({ To: `+91${phone}`, From: twilio.from, Body: `${config.appName} sign-in code: ${code}. It expires in 10 minutes.` });
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.sid}/Messages.json`, {
      method: 'POST',
      headers: { authorization: `Basic ${Buffer.from(`${twilio.sid}:${twilio.token}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' },
      body
    });
    if (!res.ok) throw new Error(`Twilio responded ${res.status}`);
  }

  async function sendWebhook(phone, code) {
    if (!webhook.url) throw new Error('OTP_WEBHOOK_URL is required');
    const res = await fetch(webhook.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(webhook.secret ? { 'x-otp-secret': webhook.secret } : {}) },
      body: JSON.stringify({ phone: `91${phone}`, code, app: config.appName })
    });
    if (!res.ok) throw new Error(`OTP webhook responded ${res.status}`);
  }

  const senders = { console: sendConsole, msg91: sendMsg91, twilio: sendTwilio, webhook: sendWebhook };
  const send = senders[provider];
  if (!send) throw new Error(`Unknown OTP_PROVIDER "${provider}" (use console, msg91, twilio or webhook)`);
  return { provider, send };
}
