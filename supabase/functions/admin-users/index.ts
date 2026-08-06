import { clients, corsHeaders, json, requireAdmin, temporaryPin } from '../_shared/security.ts';

type UserPayload = {
  id?: string; cedula?: string; nombre_completo?: string; correo?: string; rol?: string;
  activo?: boolean; temporary_password?: string;
};

const ROLES = ['docente', 'auxiliar', 'administrador'];

function clean(payload: UserPayload) {
  return {
    id: payload.id,
    cedula: String(payload.cedula || '').replace(/\D/g, '').slice(0, 20),
    nombre_completo: String(payload.nombre_completo || '').trim().slice(0, 160),
    correo: String(payload.correo || '').trim().toLowerCase().slice(0, 254),
    rol: String(payload.rol || '').toLowerCase(),
    activo: payload.activo !== false,
    temporary_password: String(payload.temporary_password || '')
  };
}

async function createUser(adminClient: any, payload: UserPayload, generated = false) {
  const user = clean(payload);
  const password = generated ? temporaryPin() : user.temporary_password;
  if (!user.cedula || !user.nombre_completo || !/^\S+@\S+\.\S+$/.test(user.correo) || !ROLES.includes(user.rol)) throw new Error('Datos de usuario incompletos o inválidos.');
  if (!/^\d{8}$/.test(password)) throw new Error('La contraseña temporal debe contener exactamente 8 dígitos.');
  const { data, error } = await adminClient.auth.admin.createUser({
    email: user.correo,
    password,
    email_confirm: true,
    app_metadata: { role: user.rol },
    user_metadata: { display_name: user.nombre_completo }
  });
  if (error || !data.user) throw error || new Error('No fue posible crear el usuario Auth.');
  const { error: profileError } = await adminClient.from('profiles').insert({
    id: data.user.id, cedula: user.cedula, nombre_completo: user.nombre_completo,
    correo: user.correo, rol: user.rol, activo: user.activo, requiere_cambio_clave: true
  });
  if (profileError) { await adminClient.auth.admin.deleteUser(data.user.id); throw profileError; }
  return { id: data.user.id, cedula: user.cedula, nombre_completo: user.nombre_completo, correo: user.correo, temporary_password: password };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(request) });
  if (request.method !== 'POST') return json(request, { error: 'Método no permitido.' }, 405);
  try {
    const { adminClient } = clients();
    const caller = await requireAdmin(request, adminClient);
    const { action, payload } = await request.json();

    if (action === 'create') return json(request, { user: await createUser(adminClient, payload) });

    if (action === 'bulk_create') {
      const users = Array.isArray(payload?.users) ? payload.users.slice(0, 100) : [];
      if (!users.length) return json(request, { error: 'No se recibieron usuarios.' }, 400);
      const credentials = []; const errors = [];
      for (let index = 0; index < users.length; index += 1) {
        try { credentials.push(await createUser(adminClient, users[index], true)); }
        catch (error) { errors.push({ row: index + 2, cedula: users[index]?.cedula, error: error instanceof Error ? error.message : 'Error desconocido' }); }
      }
      await adminClient.from('audit_logs').insert({ user_id: caller.id, accion: 'BULK_IMPORT', entidad: 'profiles', valores_nuevos: { created: credentials.length, errors: errors.length } });
      return json(request, { credentials, errors, created: credentials.length }, errors.length ? 207 : 200);
    }

    const user = clean(payload || {});
    if (!user.id) return json(request, { error: 'Identificador requerido.' }, 400);
    if (user.id === caller.id && (user.activo === false || (user.rol && user.rol !== 'administrador'))) return json(request, { error: 'No puede desactivar ni retirar su propio rol administrativo.' }, 400);

    if (action === 'update') {
      const authUpdates: Record<string, unknown> = {};
      if (user.correo) authUpdates.email = user.correo;
      if (user.rol) authUpdates.app_metadata = { role: user.rol };
      if (Object.keys(authUpdates).length) {
        const { error } = await adminClient.auth.admin.updateUserById(user.id, authUpdates);
        if (error) throw error;
      }
      const profileUpdates: Record<string, unknown> = {};
      for (const key of ['cedula','nombre_completo','correo','rol','activo']) if ((user as any)[key] !== '' && (user as any)[key] !== undefined) profileUpdates[key] = (user as any)[key];
      const { error } = await adminClient.from('profiles').update(profileUpdates).eq('id', user.id);
      if (error) throw error;
      return json(request, { success: true });
    }

    if (action === 'reset_password') {
      const password = temporaryPin();
      const { error } = await adminClient.auth.admin.updateUserById(user.id, { password });
      if (error) throw error;
      await adminClient.from('profiles').update({ requiere_cambio_clave: true }).eq('id', user.id);
      return json(request, { temporary_password: password });
    }

    if (action === 'delete') {
      if (user.id === caller.id) return json(request, { error: 'No puede eliminar su propia cuenta.' }, 400);
      const { error } = await adminClient.auth.admin.deleteUser(user.id);
      if (error) throw error;
      return json(request, { success: true });
    }
    return json(request, { error: 'Acción no permitida.' }, 400);
  } catch (error) {
    if (error instanceof Response) return json(request, { error: error.status === 403 ? 'No tiene permisos para realizar esta acción.' : 'Sesión no válida.' }, error.status);
    console.error('admin-users:', error instanceof Error ? error.message : 'unknown');
    return json(request, { error: error instanceof Error ? error.message : 'No fue posible completar la operación.' }, 400);
  }
});
