import { cp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
try {
  const env = await readFile(resolve(root, '.env'), 'utf8');
  for (const line of env.split(/\r?\n/)) {
    const match = line.match(/^([A-Z_]+)=(.*)$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim();
  }
} catch { /* Vercel injects environment variables. */ }

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_PUBLISHABLE_KEY || '';
if (/^sb_secret_/.test(key)) throw new Error('Never use a Supabase secret key in browser configuration.');
if (key.split('.').length === 3) {
  try {
    const role = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role;
    if (role === 'service_role') throw new Error('Never use a Supabase service role key in browser configuration.');
  } catch (error) {
    if (error.message.startsWith('Never use')) throw error;
  }
}
if ((url && !/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url)) || (url && !key) || (!url && key)) {
  throw new Error('Set a valid SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY.');
}
await rm(resolve(root, 'dist'), { recursive: true, force: true });
await mkdir(resolve(root, 'dist'), { recursive: true });
await cp(resolve(root, 'public'), resolve(root, 'dist'), { recursive: true });
await writeFile(resolve(root, 'dist', 'config.js'), `window.PUZZLE_CONFIG = ${JSON.stringify({ url: url.replace(/\/$/, ''), key })};\n`);
console.log(url ? 'Built with Supabase configuration.' : 'Built in local demo mode. Set Supabase variables for online multiplayer.');
