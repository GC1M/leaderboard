// Food search (#45): signed-in users only. Calls USDA FoodData Central with FDC_API_KEY (a function secret,
// never sent to the app), caches normalized foods and portions in public.foods / food_portions with the
// service role, and returns the cached rows. Parsing lives in ../_shared/fdc.ts so Jest can test it.
// eslint-disable-next-line import/no-unresolved -- Deno npm: specifier
import { createClient } from 'npm:@supabase/supabase-js@2';

import { detailUrl, failureFor, normalizeFood, parseSearchParams, searchResult, searchUrl, type FailureCode, type RawFood } from '../_shared/fdc.ts';

const TIMEOUT_MS = 8000;
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

async function fdcGet(url: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (e) {
    throw new FdcError(e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'timeout' : 0);
  }
  if (!res.ok) throw new FdcError(res.status);
  try {
    return await res.json();
  } catch {
    throw new FdcError(0);
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

  let raw: RawFood[] = [];
  let totalHits = 0;
  try {
    const found = searchResult(await fdcGet(searchUrl(parsed.params, apiKey)));
    totalHits = found.totalHits;
    if (found.ids.length > 0) {
      const detail = await fdcGet(detailUrl(found.ids, apiKey));
      const list = Array.isArray(detail) ? (detail as RawFood[]) : [];
      raw = found.ids.map((id) => list.find((f) => f?.fdcId === id)).filter((f): f is RawFood => !!f);
    }
  } catch (e) {
    const f = failureFor(e instanceof FdcError ? e.status : 0);
    console.error('fdc failure', f.code, e instanceof FdcError ? e.status : '');
    return fail(f.code, f.message, f.httpStatus);
  }

  const items = raw.map(normalizeFood).filter((x) => x !== null);
  if (items.length === 0) return reply({ foods: [], page: parsed.params.page, totalHits });

  // Upsert by provider + provider_id, so a repeat search refreshes the cached values and keeps the same ids.
  const admin = createClient(url, service);
  const { data: foods, error } = await admin.from('foods').upsert(items.map((i) => i.food), { onConflict: 'provider,provider_id' }).select();
  if (error) {
    console.error('food cache write failed', error.code);
    return fail('cache_error', 'Could not save the search results.', 500);
  }
  const idByProvider = new Map(foods.map((f) => [f.provider_id, f.id]));
  const portionRows = items.flatMap((i) => i.portions.map((p) => ({ ...p, food_id: idByProvider.get(i.food.provider_id)! })));
  const { data: portions, error: portionError } = portionRows.length
    ? await admin.from('food_portions').upsert(portionRows, { onConflict: 'food_id,label' }).select()
    : { data: [], error: null };
  if (portionError) {
    console.error('portion cache write failed', portionError.code);
    return fail('cache_error', 'Could not save the search results.', 500);
  }

  // Keep FDC's relevance order.
  const ordered = items.map((i) => foods.find((f) => f.provider_id === i.food.provider_id)!);
  return reply({
    foods: ordered.map((f) => ({ ...f, food_portions: (portions ?? []).filter((p) => p.food_id === f.id) })),
    page: parsed.params.page,
    totalHits,
  });
});
