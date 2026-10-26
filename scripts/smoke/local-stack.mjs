// Reads the local Supabase stack's URL and keys from `supabase status -o env`.
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY override it. Never log the keys.
import { execFileSync } from 'node:child_process';

const FIRST = (env, names) => names.map((n) => env[n]).find(Boolean);

function parseEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(?:"(.*)"|(.*))$/);
    if (m) out[m[1]] = m[2] ?? m[3];
  }
  return out;
}

export function getLocalStack() {
  let env = process.env;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const cli = process.env.SUPABASE_CLI ?? 'supabase';
    let text;
    try {
      text = execFileSync(cli, ['status', '-o', 'env'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      throw new Error(`Could not run "${cli} status -o env". Is the local stack running (supabase start)? ${String(e.stderr ?? e.message).split('\n')[0]}`);
    }
    env = { ...parseEnv(text), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('SUPABASE_'))) };
  }
  const url = FIRST(env, ['SUPABASE_URL', 'API_URL']);
  const anonKey = FIRST(env, ['SUPABASE_ANON_KEY', 'ANON_KEY', 'PUBLISHABLE_KEY']);
  const serviceKey = FIRST(env, ['SUPABASE_SERVICE_ROLE_KEY', 'SERVICE_ROLE_KEY', 'SECRET_KEY']);
  const missing = [['URL', url], ['anon key', anonKey], ['service role key', serviceKey]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) throw new Error(`Local stack did not report: ${missing.join(', ')}.`);
  return { url, anonKey, serviceKey };
}
