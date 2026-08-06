import { clients, corsHeaders, identifierHash, isBlocked, json, registerFailure, validRedirect } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  const generic = { message: 'Si la información coincide con una cuenta activa, recibirá las instrucciones en su correo electrónico.' };
  if (request.method !== 'POST') return json(request, generic);
  try {
    const { publicClient, adminClient } = clients();
    const body = await request.json();
    const cedula = String(body.cedula || '').replace(/\D/g, '').slice(0, 20);
    const email = String(body.email || '').trim().toLowerCase().slice(0, 254);
    const redirectTo = validRedirect(body.redirectTo);
    if (!cedula || !email || !redirectTo) return json(request, generic);
    const hash = await identifierHash(request, `recovery:${cedula}`);
    if (await isBlocked(adminClient, hash)) return json(request, generic);
    const { data: profile } = await adminClient.from('profiles').select('correo,activo').eq('cedula', cedula).maybeSingle();
    if (!profile?.activo || profile.correo !== email) { await registerFailure(adminClient, hash); return json(request, generic); }
    await publicClient.auth.resetPasswordForEmail(email, { redirectTo });
    return json(request, generic);
  } catch (error) {
    console.error('recover-account:', error instanceof Error ? error.message : 'unknown');
    return json(request, generic);
  }
});
