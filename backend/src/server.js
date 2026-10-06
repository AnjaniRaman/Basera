import { createApp } from './app.js';

const { app, config, otp } = await createApp();

app.listen(config.port, config.host, () => {
  console.log(`${config.appName} API listening on http://${config.host}:${config.port} (${config.production ? 'production' : 'development'})`);
  if (otp.provider === 'console') console.log('OTP codes are printed to this log (OTP_PROVIDER=console). Set OTP_PROVIDER=msg91|twilio|webhook for real SMS.');
  if (config.devOtp) console.log(`A fixed development OTP is enabled (AUTH_DEV_OTP).${config.production ? ' Remove ALLOW_DEV_OTP before going live.' : ''}`);
});
