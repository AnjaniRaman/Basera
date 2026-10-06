// Starts the API (port 4000, embedded database) and the web app (port 5173) together.
import { spawn } from 'node:child_process';
const run = (name, args, env = {}) => { const p = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...env } }); p.on('exit', (code) => { console.log(`${name} stopped`); process.exit(code ?? 0); }); return p; };
const procs = [run('api', ['run', 'dev', '--workspace', 'backend'], { AUTH_DEV_OTP: process.env.AUTH_DEV_OTP || '123456', SERVE_FRONTEND: '0' }), run('web', ['run', 'dev', '--workspace', 'frontend'])];
process.on('SIGINT', () => procs.forEach((p) => p.kill('SIGINT')));
