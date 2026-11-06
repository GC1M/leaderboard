// Food search (#45): signed-in users only. Calls USDA FoodData Central with FDC_API_KEY (a function secret,
// never sent to the app), caches normalized foods and portions in public.foods / food_portions with the
// service role, and returns the cached rows. Parsing lives in ../_shared/fdc.ts so Jest can test it.
// Each user gets SEARCHES_PER_USER_HOUR searches per rolling hour and all users together GLOBAL_SEARCHES_PER_HOUR
// (food_search_allow), because the FDC key is shared (1,000 requests per hour, 2 per search).
// If FDC fails, matching rows already in the cache are returned with `fromCache: true` and the failure code.
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

import { cacheItems, detailUrl, failureFor, orderedResponse, parseSearchParams, portionRows, searchResult, searchUrl, type FailureCode, type RawFood } from '../_shared/fdc.ts';

const TIMEOUT_MS = 8000;
const SEARCHES_PER_USER_HOUR = 30;
const GLOBAL_SEARCHES_PER_HOUR = 400;
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
const fail = (code: FailureCode | 'unauthorized' | 'bad_request' | 'cache_error', message: string, status: number) => reply({ error: { code, message } }, status);

class FdcError extends Error {
  constructor(readonly status: number | 'timeout') {
    super('fdc');
  }
}

const isTimeout = (e: unknown) => e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError');

// The timeout signal covers the body read too, so a stall there is a timeout as well.
async function fdcGet(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new FdcError(res.status);
    return await res.json();
  } catch (e) {
    if (e instanceof FdcError) throw e;
    throw new FdcError(isTimeout(e) ? 'timeout' : 0);
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return fail('bad_request', 'Use POST.', 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const apiKey = Deno.env.get('FDC_API_KEY');
  if (!url || !anon || !service || !apiKey) return fail('not_configured', 'Food search is not set up on the server.', 503);

  const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
  const { data: user } = await caller.auth.getUser();
  if (!user.user) return fail('unauthorized', 'Sign in to search foods.', 401);

  const parsed = parseSearchParams(await req.json().catch(() => null));
  if (!parsed.ok) return fail('bad_request', parsed.message, 400);

  const admin = createClient(url, service);
  const { data: allowed, error: limitError } = await admin.rpc('food_search_allow', { p_user: user.user.id, p_limit: SEARCHES_PER_USER_HOUR, p_global_limit: GLOBAL_SEARCHES_PER_HOUR });
  if (limitError) {
    console.error('search limit check failed', limitError.code);
    return fail('cache_error', 'Could not check the search limit.', 500);
  }
  if (!allowed) return fail('rate_limited', 'Food search is busy. Try again in a few minutes.', 429);

  let raw: RawFood[] = [];
  let order: string[] = [];
  let totalHits = 0;
  try {
    const found = searchResult(await fdcGet(searchUrl(parsed.params, apiKey)));
    totalHits = found.totalHits;
    order = found.ids.map(String);
    if (found.ids.length > 0) {
      const detail = await fdcGet(detailUrl(found.ids, apiKey));
      raw = Array.isArray(detail) ? (detail as RawFood[]) : [];
    }
  } catch (e) {
    const f = failureFor(e instanceof FdcError ? e.status : 0);
    console.error('fdc failure', f.code, e instanceof FdcError ? e.status : '');
    // Fall back to foods already cached whose name matches. The cache has one page only.
    if (parsed.params.page > 1) return reply({ foods: [], page: parsed.params.page, totalHits: 0, fromCache: true, failure: f.code });
    const pattern = `%${parsed.params.query.replace(/[\\%_]/g, '\\$&')}%`;
    const { data: cached } = await admin.from('foods').select('*, food_portions(*)').eq('provider', 'usda_fdc').ilike('name', pattern).order('name').limit(20);
    if (!cached || cached.length === 0) return fail(f.code, f.message, f.httpStatus);
    const portions = cached.flatMap((c) => c.food_portions ?? []);
    return reply({
      foods: orderedResponse(cached, portions, []),
      page: 1,
      totalHits: cached.length,
      fromCache: true,
      failure: f.code,
    });
  }

  const items = cacheItems(raw);
  if (items.length === 0) return reply({ foods: [], page: parsed.params.page, totalHits });

  // Upsert by provider + provider_id in a fixed order, so a repeat search refreshes the values and keeps the same ids.
  const { data: foods, error } = await admin.from('foods').upsert(items.map((i) => i.food), { onConflict: 'provider,provider_id' }).select();
  if (error) {
    console.error('food cache write failed', error.code);
    return fail('cache_error', 'Could not save the search results.', 500);
  }
  const rows = portionRows(items, foods);
  const { data: portions, error: portionError } = rows.length
    ? await admin.from('food_portions').upsert(rows, { onConflict: 'food_id,label' }).select()
    : { data: [], error: null };
  if (portionError) {
    console.error('portion cache write failed', portionError.code);
    return fail('cache_error', 'Could not save the search results.', 500);
  }

  return reply({ foods: orderedResponse(foods, portions ?? [], order), page: parsed.params.page, totalHits });
});
