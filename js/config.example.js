export const APP_CONFIG = Object.freeze({
  supabaseUrl: 'https://SU-PROYECTO.supabase.co',
  supabasePublishableKey: 'sb_publishable_REEMPLAZAR',
  currentAcademicYear: 2027,
  schoolName: 'CTP Cañas',
  functionNames: {
    signIn: 'sign-in-by-cedula',
    recover: 'recover-account',
    adminUsers: 'admin-users',
    changePassword: 'change-password'
  }
});

export function isConfigured() {
  return !APP_CONFIG.supabaseUrl.includes('SU-PROYECTO')
    && !APP_CONFIG.supabasePublishableKey.includes('REEMPLAZAR');
}
