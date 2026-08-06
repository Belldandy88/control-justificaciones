import { APP_CONFIG } from './config.js';
import { getSupabase, invokePublicFunction } from './supabase-client.js';
import { educationCycle, normalizeCedula, normalizeText } from './utils.js';

function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}

export class ApiService {
  constructor() { this.supabase = getSupabase(); }

  async profile() {
    const { data: { user }, error: userError } = await this.supabase.auth.getUser();
    if (userError || !user) throw userError || new Error('La sesión no es válida.');
    return unwrap(await this.supabase.from('profiles').select('*').eq('id', user.id).eq('activo', true).single());
  }

  async dashboard(year) {
    const [students, justifications, lessons, users] = await Promise.all([
      this.supabase.from('students').select('*', { count: 'exact', head: true }).eq('activo', true).eq('curso_lectivo', year),
      this.supabase.from('absence_justifications').select('*', { count: 'exact', head: true }).eq('curso_lectivo', year),
      this.supabase.from('absence_justifications').select('cantidad_lecciones').eq('curso_lectivo', year),
      this.supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('activo', true)
    ]);
    for (const result of [students, justifications, lessons]) if (result.error) throw result.error;
    return {
      students: students.count || 0,
      justifications: justifications.count || 0,
      lessons: (lessons.data || []).reduce((sum, row) => sum + Number(row.cantidad_lecciones || 0), 0),
      users: users.error ? null : users.count || 0
    };
  }

  async searchStudents({ term = '', level = '', section = '', year = APP_CONFIG.currentAcademicYear, limit = 30 } = {}) {
    let query = this.supabase.from('students').select('*').eq('curso_lectivo', Number(year)).eq('activo', true).order('primer_apellido').order('segundo_apellido').limit(limit);
    const clean = normalizeText(term);
    const cedula = normalizeCedula(term);
    if (clean) query = query.or(`search_key.ilike.%${clean}%,cedula.ilike.%${cedula || clean}%`);
    if (level) query = query.eq('nivel', Number(level));
    if (section) query = query.ilike('seccion', `%${String(section).trim()}%`);
    return unwrap(await query);
  }

  async studentWithJustifications(studentId, year = APP_CONFIG.currentAcademicYear) {
    const [student, justifications] = await Promise.all([
      this.supabase.from('students').select('*').eq('id', studentId).single(),
      this.supabase.from('absence_justifications').select('*, created_by_profile:profiles!absence_justifications_created_by_fkey(nombre_completo)').eq('student_id', studentId).eq('curso_lectivo', Number(year)).order('fecha_ausencia', { ascending: false })
    ]);
    return { student: unwrap(student), justifications: unwrap(justifications) };
  }

  async saveJustification(record) {
    const payload = {
      student_id: record.student_id,
      fecha_ausencia: record.fecha_ausencia,
      cantidad_lecciones: Number(record.cantidad_lecciones),
      motivo: record.motivo.trim(),
      periodo: record.periodo,
      justificante_medico: Boolean(record.justificante_medico),
      observacion: record.observacion?.trim() || null,
      curso_lectivo: Number(record.curso_lectivo)
    };
    if (record.id) return unwrap(await this.supabase.from('absence_justifications').update(payload).eq('id', record.id).select().single());
    return unwrap(await this.supabase.from('absence_justifications').insert(payload).select().single());
  }

  async deleteJustification(id) {
    return unwrap(await this.supabase.from('absence_justifications').delete().eq('id', id).select('id').single());
  }

  async saveStudent(record) {
    const payload = {
      cedula: normalizeCedula(record.cedula), nombre: record.nombre.trim(),
      primer_apellido: record.primer_apellido.trim(), segundo_apellido: record.segundo_apellido.trim(),
      nivel: Number(record.nivel), seccion: record.seccion.trim(), curso_lectivo: Number(record.curso_lectivo),
      ciclo_educativo: educationCycle(record.nivel), activo: Boolean(record.activo)
    };
    if (record.id) return unwrap(await this.supabase.from('students').update(payload).eq('id', record.id).select().single());
    return unwrap(await this.supabase.from('students').insert(payload).select().single());
  }

  async deleteStudent(id) {
    return unwrap(await this.supabase.from('students').delete().eq('id', id).select('id').single());
  }

  async listUsers(term = '', role = '') {
    let query = this.supabase.from('profiles').select('id,cedula,nombre_completo,correo,rol,activo,requiere_cambio_clave,created_at').order('nombre_completo').limit(100);
    const clean = normalizeText(term);
    if (clean) query = query.or(`search_key.ilike.%${clean}%,cedula.ilike.%${normalizeCedula(term) || clean}%,correo.ilike.%${clean}%`);
    if (role) query = query.eq('rol', role);
    return unwrap(await query);
  }

  async adminUser(action, payload) {
    const { data: { session } } = await this.supabase.auth.getSession();
    if (!session) throw new Error('La sesión expiró.');
    return invokePublicFunction(APP_CONFIG.functionNames.adminUsers, { action, payload }, session.access_token);
  }

  async importStudents(rows) {
    const payload = rows.map((row) => ({
      cedula: normalizeCedula(row.cedula), nombre: String(row.nombre || '').trim(),
      primer_apellido: String(row.primer_apellido || '').trim(), segundo_apellido: String(row.segundo_apellido || '').trim(),
      nivel: Number(row.nivel), seccion: String(row.seccion || '').trim(), curso_lectivo: Number(row.curso_lectivo),
      ciclo_educativo: educationCycle(row.nivel), activo: !['false', 'inactivo', 'no', '0'].includes(String(row.estado).toLowerCase())
    }));
    return unwrap(await this.supabase.from('students').upsert(payload, { onConflict: 'cedula,curso_lectivo' }).select());
  }

  async audit(limit = 100) {
    return unwrap(await this.supabase.from('audit_logs').select('*, profile:profiles(nombre_completo)').order('created_at', { ascending: false }).limit(limit));
  }

  async exportTable(table) {
    const allowed = ['students', 'absence_justifications', 'profiles'];
    if (!allowed.includes(table)) throw new Error('Exportación no permitida.');
    const columns = table === 'profiles' ? 'cedula,nombre_completo,correo,rol,activo,created_at' : '*';
    return unwrap(await this.supabase.from(table).select(columns).limit(10000));
  }
}
