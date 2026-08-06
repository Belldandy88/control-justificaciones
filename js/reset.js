import { isConfigured } from './config.js';
import { getSupabase, invokePublicFunction } from './supabase-client.js';
import { APP_CONFIG } from './config.js';
import { validatePassword } from './utils.js';

const form = document.querySelector('#reset-form');
const message = document.querySelector('#reset-message');

function show(text, type = '') { message.textContent = text; message.className = `notice ${type}`; }

if (!isConfigured()) {
  show('La conexión con Supabase todavía no está configurada.', 'error');
  form.querySelector('button').disabled = true;
} else {
  const supabase = getSupabase();
  supabase.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') show('Enlace verificado. Ingrese una contraseña nueva.', 'success');
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.querySelector('#new-password').value;
    const confirmation = document.querySelector('#confirm-password').value;
    const result = validatePassword(password);
    if (!result.valid) return show(`La contraseña debe incluir ${result.errors.join(', ')}.`, 'error');
    if (password !== confirmation) return show('Las contraseñas no coinciden.', 'error');
    const button = form.querySelector('button'); button.disabled = true; button.textContent = 'Guardando…';
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { show('El enlace ya no es válido. Solicite uno nuevo.', 'error'); button.disabled = false; button.textContent = 'Guardar contraseña'; return; }
    try { await invokePublicFunction(APP_CONFIG.functionNames.changePassword, { password }, session.access_token); }
    catch (error) { show(error.message, 'error'); button.disabled = false; button.textContent = 'Guardar contraseña'; return; }
    show('La contraseña fue actualizada. Ya puede volver al inicio de sesión.', 'success');
    form.reset(); button.textContent = 'Contraseña guardada';
  });
}
