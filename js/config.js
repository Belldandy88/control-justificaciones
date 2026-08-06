// Esta clave es publicable y puede usarse en el navegador únicamente con RLS activo.
// Nunca coloque aquí SUPABASE_SECRET_KEY ni service_role.
export const APP_CONFIG = Object.freeze({
  supabaseUrl: 'REEMPLAZAR_CON_URL_SUPABASE',
  supabasePublishableKey: 'REEMPLAZAR_CON_CLAVE_PUBLICABLE',
  currentAcademicYear: new Date().getFullYear(),
  schoolName: 'CTP Cañas',
  functionNames: {
    signIn: 'sign-in-by-cedula',
    recover: 'recover-account',
    adminUsers: 'admin-users',
    changePassword: 'change-password'
  }
});

export function isConfigured() {
  return /^https:\/\/.+\.supabase\.co$/.test(APP_CONFIG.supabaseUrl)
    && /^(sb_publishable_|eyJ)/.test(APP_CONFIG.supabasePublishableKey);
}
