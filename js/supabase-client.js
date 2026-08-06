import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.57.4/+esm';
import { APP_CONFIG, isConfigured } from './config.js';

let instance;

export function getSupabase() {
  if (!isConfigured()) throw new Error('El sistema todavía no está conectado con Supabase.');
  if (!instance) {
    instance = createClient(APP_CONFIG.supabaseUrl, APP_CONFIG.supabasePublishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }
  return instance;
}

export async function invokePublicFunction(functionName, body, accessToken) {
  if (!isConfigured()) throw new Error('El sistema todavía no está conectado con Supabase.');
  const headers = {
    'Content-Type': 'application/json',
    apikey: APP_CONFIG.supabasePublishableKey
  };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const response = await fetch(`${APP_CONFIG.supabaseUrl}/functions/v1/${functionName}`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || payload.message || 'No fue posible completar la solicitud.');
  return payload;
}
