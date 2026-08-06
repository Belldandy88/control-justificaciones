import { authenticatedUser, clients, corsHeaders, json } from '../_shared/security.ts';

function validPassword(password: string): boolean {
  return password.length >= 10 && password.length <= 128
    && /[A-ZÁÉÍÓÚÑ]/.test(password) && /[a-záéíóúñ]/.test(password)
    && /\d/.test(password) && /[^\p{L}\p{N}\s]/u.test(password);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método no permitido.' }, 405);
  try {
    const { adminClient } = clients();
    const user = await authenticatedUser(request, adminClient);
    const body = await request.json();
    const password = String(body.password || '');
    if (!validPassword(password)) return json(request, { error: 'La contraseña no cumple los requisitos de seguridad.' }, 400);
    const { error } = await adminClient.auth.admin.updateUserById(user.id, { password });
    if (error) throw error;
    await adminClient.from('profiles').update({ requiere_cambio_clave: false }).eq('id', user.id);
    return json(request, { success: true });
  } catch (error) {
    if (error instanceof Response) return json(request, { error: 'Sesión no válida.' }, error.status);
    console.error('change-password:', error instanceof Error ? error.message : 'unknown');
    return json(request, { error: 'No fue posible actualizar la contraseña.' }, 400);
  }
});
