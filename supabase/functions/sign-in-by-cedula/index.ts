import { clients, clearFailures, corsHeaders, identifierHash, isBlocked, json, registerFailure } from '../_shared/security.ts';

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método no permitido.' }, 405);
  const generic = () => json(request, { error: 'Los datos ingresados no son correctos o la cuenta no está disponible.' }, 401);
  try {
    const { publicClient, adminClient } = clients();
    const body = await request.json();
    const cedula = String(body.cedula || '').replace(/\D/g, '').slice(0, 20);
    const password = String(body.password || '');
    if (!cedula || !password || password.length > 128) return generic();
    const hash = await identifierHash(request, cedula);
    if (await isBlocked(adminClient, hash)) return json(request, { error: 'Demasiados intentos. Espere 15 minutos antes de volver a intentarlo.' }, 429);

    const { data: profile } = await adminClient.from('profiles').select('id,activo').eq('cedula', cedula).maybeSingle();
    if (!profile?.activo) { await registerFailure(adminClient, hash); return generic(); }
    const { data: authData, error: userError } = await adminClient.auth.admin.getUserById(profile.id);
    if (userError || !authData.user?.email) { await registerFailure(adminClient, hash); return generic(); }
    const { data, error } = await publicClient.auth.signInWithPassword({ email: authData.user.email, password });
    if (error || !data.session) {
      await registerFailure(adminClient, hash);
      await adminClient.from('audit_logs').insert({ user_id: profile.id, accion: 'LOGIN_FAILED', entidad: 'auth', registro_id: profile.id });
      return generic();
    }
    await clearFailures(adminClient, hash);
    return json(request, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_in: data.session.expires_in,
      token_type: data.session.token_type
    });
  } catch (error) {
    console.error('sign-in-by-cedula:', error instanceof Error ? error.message : 'unknown');
    return generic();
  }
});
