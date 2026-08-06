import test from 'node:test';
import assert from 'node:assert/strict';
import {
  educationCycle, normalizeCedula, normalizeText, totalsByPeriod, validateEmail, validatePassword
} from '../js/utils.js';

test('normaliza texto en español para búsquedas', () => {
  assert.equal(normalizeText('  José Núñez  '), 'jose nunez');
});

test('normaliza una cédula sin separadores', () => {
  assert.equal(normalizeCedula('5-0366-0602'), '503660602');
});

test('asigna el ciclo educativo por nivel', () => {
  assert.equal(educationCycle(9), 'III Ciclo');
  assert.equal(educationCycle(10), 'Educación Diversificada');
});

test('calcula registros y lecciones por periodo', () => {
  const result = totalsByPeriod([
    { periodo: 'I', cantidad_lecciones: 3 },
    { periodo: 'I', cantidad_lecciones: 2 },
    { periodo: 'II', cantidad_lecciones: 4 }
  ]);
  assert.deepEqual(result, { I: { records: 2, lessons: 5 }, II: { records: 1, lessons: 4 }, totalLessons: 9 });
});

test('valida correos y contraseñas', () => {
  assert.equal(validateEmail('persona@example.com'), true);
  assert.equal(validateEmail('correo-invalido'), false);
  assert.equal(validatePassword('ClaveSegura9*').valid, true);
  assert.equal(validatePassword('12345678').valid, false);
});
