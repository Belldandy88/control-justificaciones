import * as XLSX from 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm';
import { educationCycle, normalizeCedula, validateEmail } from './utils.js';

const STUDENT_HEADERS = ['cedula', 'nombre', 'primer_apellido', 'segundo_apellido', 'nivel', 'seccion', 'curso_lectivo', 'estado'];
const USER_HEADERS = ['cedula', 'nombre_completo', 'correo', 'rol', 'estado'];

function normalizeHeader(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/\s+/g, '_');
}

export async function readImportFile(file) {
  if (!file) throw new Error('Seleccione un archivo.');
  if (file.size > 5 * 1024 * 1024) throw new Error('El archivo no puede superar 5 MB.');
  const data = await file.arrayBuffer();
  const workbook = XLSX.read(data, { type: 'array', cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  return raw.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [normalizeHeader(key), value])));
}

export function validateStudentRows(rows) {
  return validateRows(rows, 'students');
}

export function validateUserRows(rows) {
  return validateRows(rows, 'users');
}

function validateRows(rows, type) {
  if (!rows.length) return { validRows: [], invalidRows: [{ row: 1, errors: ['El archivo no contiene datos.'], data: {} }], headers: [] };
  const required = type === 'students' ? STUDENT_HEADERS.slice(0, 7) : USER_HEADERS.slice(0, 4);
  const headers = Object.keys(rows[0]);
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) return { validRows: [], invalidRows: [{ row: 1, errors: [`Faltan columnas: ${missing.join(', ')}`], data: rows[0] }], headers };
  const seen = new Set();
  const validRows = [];
  const invalidRows = [];
  rows.forEach((data, index) => {
    const errors = [];
    const cedula = normalizeCedula(data.cedula);
    if (!cedula) errors.push('Cédula requerida');
    const duplicateKey = type === 'students' ? `${cedula}-${data.curso_lectivo}` : cedula;
    if (seen.has(duplicateKey)) errors.push('Registro duplicado en el archivo');
    seen.add(duplicateKey);
    if (type === 'students') {
      if (!data.nombre || !data.primer_apellido) errors.push('Nombre y primer apellido requeridos');
      if (![7,8,9,10,11,12].includes(Number(data.nivel))) errors.push('Nivel inválido');
      if (!/^([7-9]|1[0-2])-[1-6]$/.test(String(data.seccion).trim())) errors.push('Sección inválida');
      if (!/^20\d{2}$/.test(String(data.curso_lectivo))) errors.push('Curso lectivo inválido');
      data.ciclo_educativo = educationCycle(data.nivel);
    } else {
      if (!data.nombre_completo) errors.push('Nombre completo requerido');
      if (!validateEmail(data.correo)) errors.push('Correo inválido');
      if (!['docente', 'auxiliar', 'administrador'].includes(String(data.rol).toLowerCase())) errors.push('Rol inválido');
    }
    const entry = { row: index + 2, errors, data: { ...data, cedula } };
    (errors.length ? invalidRows : validRows).push(entry);
  });
  return { validRows, invalidRows, headers };
}
