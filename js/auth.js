import { APP_CONFIG } from './config.js';
import { getSupabase, invokePublicFunction } from './supabase-client.js';
import { normalizeCedula } from './utils.js';

export async function signInByCedula(cedula, password) {
  const cleanCedula = normalizeCedula(cedula);
  if (!cleanCedula || !password) throw new Error('Ingrese la cédula y la contraseña.');
  const result = await invokePublicFunction(APP_CONFIG.functionNames.signIn, { cedula: cleanCedula, password });
  if (!result.access_token || !result.refresh_token) throw new Error('La respuesta de autenticación no es válida.');
  const { data, error } = await getSupabase().auth.setSession({
    access_token: result.access_token,
    refresh_token: result.refresh_token
  });
  if (error) throw error;
  return data.session;
}

export async function requestPasswordRecovery(cedula, email) {
  return invokePublicFunction(APP_CONFIG.functionNames.recover, {
    cedula: normalizeCedula(cedula),
    email: String(email).trim().toLowerCase(),
    redirectTo: new URL('./reset.html', window.location.href).href
  });
}

export async function signOut() {
  const { error } = await getSupabase().auth.signOut();
  if (error) throw error;
}

export async function currentSession() {
  const { data, error } = await getSupabase().auth.getSession();
  if (error) throw error;
  return data.session;
}
