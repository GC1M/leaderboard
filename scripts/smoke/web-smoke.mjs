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

  // Deterministic UI regression: real router/auth client, synthetic auth responses, no real account or email.
  await visit(browser, base, 'invite survives sign-in and unavailable groups explain why', async (page) => {
    const user = { id: '12345678-1234-1234-1234-123456789abc', aud: 'authenticated', role: 'authenticated', email: 'invite@example.com', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
    await page.route(/\/auth\/v1\//, (route) => {
      const path = new URL(route.request().url()).pathname;
      const body = path.endsWith('/verify') ? { access_token: 'ui-test-access-token', refresh_token: 'ui-test-refresh-token', token_type: 'bearer', expires_in: 3600, user } : path.endsWith('/user') ? user : {};
      return route.fulfill({ json: body });
    });
    await page.route(/\/rest\/v1\//, (route) => route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith('/profiles') ? { display_name: 'Test Player', timezone: 'UTC' } : [],
    }));
  }, async (page) => {
    let joins = 0;
    page.on('request', (req) => { if (req.url().includes('/rpc/join_group')) joins++; });
    await page.goto(`${base}/join/ABCD2345`);
    await page.getByPlaceholder('you@example.com').fill('invite@example.com');
    await page.getByText('Send Me a Code', { exact: true }).click();
    await page.getByLabel('6-digit code', { exact: true }).fill('123456');
    await page.getByText('Join with code ABCD 2345?', { exact: true }).waitFor();
    if (joins) throw new Error('Invite joined without confirmation');
    await page.getByText('Not Now', { exact: true }).click();
    await page.getByRole('tab', { name: 'Summary', exact: true }).waitFor();
    // Also exercises an invalid UUID without a backend 400 and a useful, dismissible notice.
    await page.goto(`${base}/groups/not-a-uuid`);
    await page.getByText('This group is unavailable.', { exact: false }).waitFor();
    await page.getByText('Dismiss Notice', { exact: true }).click();
    await page.getByText('This group is unavailable.', { exact: false }).waitFor({ state: 'hidden' });
    await page.getByRole('tab', { name: 'Profile', exact: true }).click();
    await page.getByText('Sign Out', { exact: true }).click();
    await page.getByText('Sign out?', { exact: true }).waitFor();
    await page.getByText('Cancel', { exact: true }).click();
    await page.getByRole('tab', { name: 'Profile', exact: true }).waitFor();
    await page.goto(`${base}/this-page-does-not-exist`);
    await page.getByText('Page Not Found', { exact: true }).waitFor();
    await page.getByText('Go Home', { exact: true }).click();
    await page.getByRole('tab', { name: 'Summary', exact: true }).waitFor();
  });

  // #122: real browser coverage for empty histories, decimal typing/paste, persistent tabs and drafts.
  await visit(browser, base, 'Phase 1/2 entry and tab navigation', async (page) => {
    const user = { id: '12345678-1234-1234-1234-123456789abc', aud: 'authenticated', role: 'authenticated', email: 'ux@example.com', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
    await page.route(/\/auth\/v1\//, (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/verify') ? { access_token: 'ui-test-access-token', refresh_token: 'ui-test-refresh-token', token_type: 'bearer', expires_in: 3600, user } : path.endsWith('/user') ? user : {} });
    });
    await page.route(/\/rest\/v1\//, (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/profiles') ? { display_name: 'Test Player', timezone: 'UTC' } : path.endsWith('/latest_weight') ? null : [] });
    });
  }, async (page) => {
    await page.getByPlaceholder('you@example.com').fill('ux@example.com');
    await page.getByText('Send Me a Code', { exact: true }).click();
    await page.getByLabel('6-digit code', { exact: true }).fill('123456');
    await page.getByRole('tab', { name: 'Profile', exact: true }).click();
    await page.getByText('Units', { exact: true }).click();
    await page.getByRole('radio', { name: 'Kilograms (kg)', exact: true }).click();
    await page.getByRole('radio', { name: 'Kilometers (km)', exact: true }).click();
    await page.goto(`${base}/weight`);
    await page.getByText('No weight recorded yet.', { exact: true }).waitFor();
    if (await page.getByRole('radiogroup', { name: 'Time range', exact: true }).count()) throw new Error('An empty weight history still shows ranges');
    for (const name of ['Summary', 'Workouts', 'Groups', 'Profile']) await page.getByRole('tab', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Add Weight', exact: true }).click();
    await page.getByRole('textbox', { name: 'Weight (kg)', exact: true }).fill('75.');
    if (await page.getByRole('button', { name: 'Save Weight', exact: true }).isDisabled()) throw new Error('Decimal typing left save disabled');
    await page.getByRole('textbox', { name: 'Weight (kg)', exact: true }).fill('75,5');
    await page.getByRole('button', { name: 'Weight unit: kg · Change for this entry', exact: true }).click();
    await page.getByRole('radio', { name: 'lb', exact: true }).click();
    const pounds = Number(await page.getByRole('textbox', { name: 'Weight (lb)', exact: true }).inputValue());
    if (Math.abs(pounds - 166.449) > 0.01) throw new Error('Switching units changed the physical weight');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Unsaved changes', { exact: true }).waitFor();
    await page.getByText('Save Draft', { exact: true }).click();
    await page.getByRole('button', { name: 'Resume Weight Draft', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Workouts', exact: true }).click();
    await page.getByText('No workouts yet.', { exact: false }).waitFor();
    if (await page.getByRole('radiogroup', { name: 'Time range', exact: true }).count()) throw new Error('An empty workout history still shows ranges');
    await page.getByRole('button', { name: 'Log Workout', exact: true }).click();
    await page.getByRole('combobox', { name: 'Workout type', exact: true }).click();
    await page.getByRole('radio', { name: 'Full Body', exact: true }).click();
    if (await page.getByRole('radiogroup', { name: 'Activity', exact: true }).count()) throw new Error('The separate activity selector remains visible');
    if (await page.getByRole('textbox', { name: 'Duration seconds', exact: true }).count()) throw new Error('Duration still shows seconds');
    await page.getByRole('textbox', { name: 'Duration minutes', exact: true }).fill('30');
    await page.getByRole('tab', { name: 'Groups', exact: true }).click();
    await page.getByRole('tab', { name: 'Workouts', exact: true }).click();
    if (await page.getByRole('textbox', { name: 'Duration minutes', exact: true }).inputValue() !== '30') throw new Error('Switching tabs lost the workout draft');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Discard Changes', { exact: true }).click();
    await page.getByRole('button', { name: 'Log Workout', exact: true }).waitFor();
    await page.getByRole('tab', { name: 'Workouts', exact: true }).click();
    await page.getByRole('button', { name: 'Log Workout', exact: true }).waitFor();
  });

  await visit(browser, base, 'competition invite requires separate consent and standings preserve zero', async (page) => {
    const uid = '12345678-1234-1234-1234-123456789abc';
    const groupId = '22345678-1234-1234-1234-123456789abc';
    const id = '32345678-1234-1234-1234-123456789abc';
    const user = { id: uid, aud: 'authenticated', role: 'authenticated', email: 'competition@example.com', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
    const competition = { id, group_id: groupId, creator_id: groupId, name: 'Weekend steps', metric: 'steps', starts_at: new Date(Date.now() + 2 * 86400e3).toISOString(), ends_at: new Date(Date.now() + 4 * 86400e3).toISOString(), timezone: 'UTC', include_manual: false, late_joins: false, scoring: 'total', status: 'scheduled', scoring_version: 1 };
    let participation = null;
    await page.route(/\/auth\/v1\//, (route) => {
      const path = new URL(route.request().url()).pathname;
      return route.fulfill({ json: path.endsWith('/verify') ? { access_token: 'ui-test-access-token', refresh_token: 'ui-test-refresh-token', token_type: 'bearer', expires_in: 3600, user } : path.endsWith('/user') ? user : {} });
    });
    await page.route(/\/rest\/v1\//, (route) => {
      const path = new URL(route.request().url()).pathname;
      let body = [];
      if (path.endsWith('/profiles')) body = { display_name: 'Test Player', timezone: 'UTC' };
      if (path.endsWith('/rpc/join_group')) body = groupId;
      if (path.endsWith('/competitions')) body = competition;
      if (path.endsWith('/competition_participants')) body = new URL(route.request().url()).searchParams.has('user_id') ? participation : participation ? [participation] : [];
      if (path.endsWith('/rpc/join_competition')) { participation = { competition_id: id, user_id: uid, status: 'joined' }; body = null; }
      if (path.endsWith('/rpc/competition_standings')) body = [
        { user_id: uid, display_name: 'Zero Player', score: 0, rank: 1, eligibility: 'eligible', manual_entries: 0, health_entries: 1, excluded_entries: 0, updated_at: new Date().toISOString() },
        { user_id: groupId, display_name: 'Missing Player', score: null, rank: null, eligibility: 'no_data', manual_entries: 0, health_entries: 0, excluded_entries: 0, updated_at: null },
      ];
      return route.fulfill({ json: body });
    });
  }, async (page) => {
    let optIns = 0;
    page.on('request', (req) => { if (req.url().includes('/rpc/join_competition')) optIns++; });
    await page.goto(`${base}/join/ABCD2345?competition=32345678-1234-1234-1234-123456789abc`);
    await page.getByPlaceholder('you@example.com').fill('competition@example.com');
    await page.getByText('Send Me a Code', { exact: true }).click();
    await page.getByLabel('6-digit code', { exact: true }).fill('123456');
    await page.getByText('Joining this group does not enroll you.', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Join Group', exact: true }).click();
    await page.getByRole('button', { name: 'Join Competition', exact: true }).waitFor();
    if (optIns) throw new Error('Group consent also enrolled in competition');
    await page.getByText('Health entries only', { exact: true }).waitFor();
    await page.getByText('0 steps', { exact: true }).waitFor();
    await page.getByText('No data', { exact: true }).waitFor();
    for (const name of ['Summary', 'Workouts', 'Groups', 'Profile']) await page.getByRole('tab', { name, exact: true }).waitFor();
    await page.getByRole('button', { name: 'Join Competition', exact: true }).click();
    await page.getByRole('button', { name: 'Leave Competition', exact: true }).waitFor();
    if (optIns !== 1) throw new Error(`Expected one explicit opt-in, got ${optIns}`);
  });

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
