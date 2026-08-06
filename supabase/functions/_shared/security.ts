import { createClient, SupabaseClient } from 'npm:@supabase/supabase-js@2.57.4';

const DEFAULT_ORIGINS = ['https://belldandy88.github.io', 'http://localhost:4173', 'http://localhost:8000'];

export function allowedOrigins(): string[] {
  return (Deno.env.get('ALLOWED_ORIGINS') || DEFAULT_ORIGINS.join(','))
    .split(',').map((value) => value.trim()).filter(Boolean);
}

export function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('origin') || '';
  const allowed = allowedOrigins();
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'X-Content-Type-Options': 'nosniff'
  };
}

export function json(request: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' }
  });
}

export function clients() {
  const url = Deno.env.get('SUPABASE_URL');
  const publishable = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY');
  const secret = Deno.env.get('SUPABASE_SECRET_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !publishable || !secret) throw new Error('Configuración del servidor incompleta.');
  const options = { auth: { persistSession: false, autoRefreshToken: false } };
  return {
    url,
    publishable,
    publicClient: createClient(url, publishable, options),
    adminClient: createClient(url, secret, options)
  };
}

export async function authenticatedUser(request: Request, adminClient: SupabaseClient) {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Response('No autorizado', { status: 401 });
  const { data, error } = await adminClient.auth.getUser(token);
  if (error || !data.user) throw new Response('No autorizado', { status: 401 });
  return data.user;
}

export async function requireAdmin(request: Request, adminClient: SupabaseClient) {
  const user = await authenticatedUser(request, adminClient);
  const { data: profile, error } = await adminClient.from('profiles').select('id,rol,activo').eq('id', user.id).single();
  if (error || !profile?.activo || profile.rol !== 'administrador') throw new Response('Prohibido', { status: 403 });
  return user;
}

export async function identifierHash(request: Request, identifier: string): Promise<string> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const salt = Deno.env.get('RATE_LIMIT_SALT') || 'configure-rate-limit-salt';
  const bytes = new TextEncoder().encode(`${identifier}|${ip}|${salt}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function isBlocked(adminClient: SupabaseClient, hash: string): Promise<boolean> {
  const { data } = await adminClient.from('auth_rate_limits').select('*').eq('identifier_hash', hash).maybeSingle();
  if (!data) return false;
  if (data.blocked_until && new Date(data.blocked_until) > new Date()) return true;
  const windowAge = Date.now() - new Date(data.window_started_at).getTime();
  if (windowAge > 15 * 60 * 1000) {
    await adminClient.from('auth_rate_limits').upsert({ identifier_hash: hash, attempts: 0, window_started_at: new Date().toISOString(), blocked_until: null, updated_at: new Date().toISOString() });
  }
  return false;
}

export async function registerFailure(adminClient: SupabaseClient, hash: string): Promise<void> {
  const { data } = await adminClient.from('auth_rate_limits').select('attempts,window_started_at').eq('identifier_hash', hash).maybeSingle();
  const now = new Date();
  const inWindow = data && now.getTime() - new Date(data.window_started_at).getTime() < 15 * 60 * 1000;
  const attempts = inWindow ? Number(data.attempts) + 1 : 1;
  await adminClient.from('auth_rate_limits').upsert({
    identifier_hash: hash,
    attempts,
    window_started_at: inWindow ? data.window_started_at : now.toISOString(),
    blocked_until: attempts >= 5 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null,
    updated_at: now.toISOString()
  });
}

export async function clearFailures(adminClient: SupabaseClient, hash: string): Promise<void> {
  await adminClient.from('auth_rate_limits').delete().eq('identifier_hash', hash);
}

export function validRedirect(candidate: unknown): string | null {
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return allowedOrigins().includes(url.origin) ? url.href : null;
  } catch { return null; }
}

export function temporaryPin(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(1));
  return String(bytes[0] % 100_000_000).padStart(8, '0');
}
