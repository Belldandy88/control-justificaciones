export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCedula(value = '') {
  return String(value).replace(/\D/g, '').slice(0, 20);
}

export function validateEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value).trim());
}

export function validatePassword(value = '') {
  const errors = [];
  if (value.length < 10) errors.push('al menos 10 caracteres');
  if (!/[A-ZÁÉÍÓÚÑ]/.test(value)) errors.push('una mayúscula');
  if (!/[a-záéíóúñ]/.test(value)) errors.push('una minúscula');
  if (!/\d/.test(value)) errors.push('un número');
  if (!/[^\p{L}\p{N}\s]/u.test(value)) errors.push('un símbolo');
  return { valid: errors.length === 0, errors };
}

export function formatDate(value, options = {}) {
  if (!value) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CR', {
    day: '2-digit', month: '2-digit', year: 'numeric', ...options
  }).format(date);
}

export function fullStudentName(student) {
  return [student?.nombre, student?.primer_apellido, student?.segundo_apellido]
    .filter(Boolean).join(' ');
}

export function initials(name = '') {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('') || 'US';
}

export function roleLabel(role = '') {
  return ({ docente: 'Docente', auxiliar: 'Auxiliar', administrador: 'Administrador' })[role] || role;
}

export function educationCycle(level) {
  const numericLevel = Number(level);
  if ([7, 8, 9].includes(numericLevel)) return 'III Ciclo';
  if ([10, 11, 12].includes(numericLevel)) return 'Educación Diversificada';
  return '';
}

export function totalsByPeriod(records = []) {
  return records.reduce((acc, row) => {
    const period = row.periodo === 'II' ? 'II' : 'I';
    acc[period].records += 1;
    acc[period].lessons += Number(row.cantidad_lecciones || 0);
    acc.totalLessons += Number(row.cantidad_lecciones || 0);
    return acc;
  }, { I: { records: 0, lessons: 0 }, II: { records: 0, lessons: 0 }, totalLessons: 0 });
}

export function toCsv(rows) {
  if (!rows?.length) return '';
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const quote = (value) => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    return `"${text.replaceAll('"', '""')}"`;
  };
  return [headers.map(quote).join(','), ...rows.map((row) => headers.map((header) => quote(row[header])).join(','))].join('\n');
}

export function downloadText(filename, content, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff', content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function debounce(callback, delay = 280) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

export function assertAllowedRole(role) {
  if (!['docente', 'auxiliar', 'administrador'].includes(role)) throw new Error('Rol de usuario no válido.');
  return role;
}
