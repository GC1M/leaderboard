// Loads the exported web build in headless Chromium and checks the app boots.
//   node scripts/smoke/web-smoke.mjs <export-dir> [--backend]
// Always checks: the sign-in screen renders, no uncaught page errors, and the app stays up and shows an
// error message (instead of going blank) when every Supabase call fails. With --backend, the build must
// have been exported against a running local stack, and it also checks that "Send Me a Code" reaches
// auth (the 6-digit code step appears).
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium } from 'playwright';

const dir = resolve(process.argv[2] ?? 'dist');
const withBackend = process.argv.includes('--backend');
const TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS ?? 30_000);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.ico': 'image/x-icon', '.png': 'image/png', '.ttf': 'font/ttf', '.svg': 'image/svg+xml' };

function serve() {
  const fileFor = (path) => {
    const p = normalize(join(dir, decodeURIComponent(path.split('?')[0])));
    if (!p.startsWith(dir)) return null;
    for (const c of [p, `${p}.html`, join(p, 'index.html')]) if (existsSync(c) && statSync(c).isFile()) return c;
    return join(dir, 'index.html'); // single-page output: unknown paths are client routes
  };
  const server = createServer((req, res) => {
    const f = fileFor(req.url);
    if (!f) return res.writeHead(403).end();
    res.writeHead(200, { 'content-type': TYPES[extname(f)] ?? 'application/octet-stream' });
    createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}

async function visit(browser, base, name, setup, scenario) {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(TIMEOUT);
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await setup?.(page);
  try {
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.getByText('Compete with your friends').waitFor();
    await page.getByPlaceholder('you@example.com').waitFor();
    await page.getByText('Send Me a Code').waitFor();
    await scenario?.(page);
    if (errors.length) throw new Error(`uncaught page errors: ${errors.join(' | ')}`);
    console.log(`ok    ${name}`);
  } catch (e) {
    fail(`${name}: ${e.message.split('\n')[0]}${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`);
    await page.screenshot({ path: `web-smoke-${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  } finally {
    await context.close();
  }
}

const { server, base } = await serve();
const browser = await chromium.launch();
try {
  await visit(browser, base, 'sign-in screen renders without page errors');

  if (withBackend) {
    await visit(browser, base, 'send code reaches the local auth service', null, async (page) => {
      await page.getByPlaceholder('you@example.com').fill(`web-smoke-${Date.now()}@example.com`);
      await page.getByText('Send Me a Code').click();
      await page.getByText('Enter the 6-digit code sent to').waitFor();
    });
  }

  // Backend unreachable: requests to Supabase fail at the network level.
  await visit(browser, base, 'failed network calls do not blank the app', (page) => page.route(/\/(auth|rest)\/v1\//, (route) => route.abort('connectionrefused')), async (page) => {
    await page.getByPlaceholder('you@example.com').fill('offline@example.com');
    await page.getByText('Send Me a Code').click();
    await page.getByText("Couldn't send a code").waitFor();
    await page.getByText('Compete with your friends').waitFor();
  });
} finally {
  await browser.close();
  server.close();
}
