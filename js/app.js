import { APP_CONFIG, isConfigured } from './config.js';
import { ApiService } from './api.js';
import { currentSession, requestPasswordRecovery, signInByCedula, signOut } from './auth.js';
import { readImportFile, validateStudentRows, validateUserRows } from './imports.js';
import { invokePublicFunction } from './supabase-client.js';
import {
  assertAllowedRole, debounce, downloadText, educationCycle, formatDate, fullStudentName,
  initials, normalizeCedula, roleLabel, toCsv, totalsByPeriod, validateEmail, validatePassword
} from './utils.js';

const state = {
  api: null,
  profile: null,
  selectedStudent: null,
  currentJustifications: [],
  import: null,
  confirmAction: null
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindBaseEvents();
  $('#today-label').textContent = new Intl.DateTimeFormat('es-CR', { dateStyle: 'long' }).format(new Date());
  $('#academic-year-badge').textContent = `Curso lectivo ${APP_CONFIG.currentAcademicYear}`;
  if (!isConfigured()) {
    $('#setup-banner').classList.remove('hidden');
    $('#login-button').disabled = true;
    showAuthMessage('La interfaz está lista, pero el administrador debe completar la conexión con Supabase.', 'error');
    return;
  }
  try {
    const session = await currentSession();
    if (session) await openApplication();
  } catch (error) {
    showAuthMessage(readableError(error), 'error');
  }
}

function bindBaseEvents() {
  $('#login-form').addEventListener('submit', handleLogin);
  $('#recovery-form').addEventListener('submit', handleRecovery);
  $('#show-recovery').addEventListener('click', () => toggleRecovery(true));
  $('#back-to-login').addEventListener('click', () => toggleRecovery(false));
  $$('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.togglePassword);
    input.type = input.type === 'password' ? 'text' : 'password';
    button.textContent = input.type === 'password' ? 'Ver' : 'Ocultar';
    button.setAttribute('aria-label', input.type === 'password' ? 'Mostrar contraseña' : 'Ocultar contraseña');
  }));
  $('#logout-button').addEventListener('click', handleLogout);
  $('#menu-button').addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $$('.nav-item').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.view)));
  $('#quick-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    navigate('students');
    $('#student-search').value = $('#quick-search').value;
    searchStudents();
  });
  $('#student-search-form').addEventListener('submit', (event) => { event.preventDefault(); searchStudents(); });
  $('#clear-student-filters').addEventListener('click', () => {
    $('#student-search-form').reset();
    $('#student-results').replaceChildren(emptyState('Inicie una búsqueda', 'Puede utilizar la cédula, el nombre o el primer apellido.'));
    $('#student-result-count').textContent = '0';
  });
  $('#new-student-button').addEventListener('click', () => openStudentDialog());
  $('#new-user-button').addEventListener('click', () => openUserDialog());
  $('#user-filter-form').addEventListener('submit', (event) => { event.preventDefault(); loadUsers(); });
  $('#justification-form').addEventListener('submit', saveJustification);
  $('#cancel-justification-edit').addEventListener('click', resetJustificationForm);
  $('#reason').addEventListener('input', () => { $('#reason-count').textContent = $('#reason').value.length; });
  $('#justification-student-search').addEventListener('input', debounce(loadStudentSuggestions));
  $('#confirm-cancel').addEventListener('click', closeConfirm);
  $('#confirm-accept').addEventListener('click', runConfirmedAction);
  $$('[data-file-trigger]').forEach((button) => button.addEventListener('click', () => document.getElementById(button.dataset.fileTrigger).click()));
  $('#student-import-file').addEventListener('change', (event) => prepareImport(event.target.files[0], 'students'));
  $('#user-import-file').addEventListener('change', (event) => prepareImport(event.target.files[0], 'users'));
  $('#cancel-import').addEventListener('click', clearImport);
  $('#confirm-import').addEventListener('click', confirmImport);
  $$('[data-export]').forEach((button) => button.addEventListener('click', () => exportTable(button.dataset.export)));
}

async function handleLogin(event) {
  event.preventDefault();
  const cedulaInput = $('#login-cedula');
  const passwordInput = $('#login-password');
  const cedula = normalizeCedula(cedulaInput.value);
  let valid = true;
  $('#login-cedula-error').textContent = '';
  $('#login-password-error').textContent = '';
  if (!cedula) { $('#login-cedula-error').textContent = 'Ingrese una cédula válida.'; valid = false; }
  if (!passwordInput.value) { $('#login-password-error').textContent = 'Ingrese la contraseña.'; valid = false; }
  if (!valid) return;
  setBusy($('#login-button'), true, 'Verificando…');
  try {
    await signInByCedula(cedula, passwordInput.value);
    passwordInput.value = '';
    await openApplication();
  } catch (error) {
    showAuthMessage('Los datos ingresados no son correctos o la cuenta no está disponible.', 'error');
  } finally {
    setBusy($('#login-button'), false, 'Iniciar sesión');
  }
}

async function handleRecovery(event) {
  event.preventDefault();
  const cedula = normalizeCedula($('#recovery-cedula').value);
  const email = $('#recovery-email').value.trim();
  if (!cedula || !validateEmail(email)) return showAuthMessage('Revise la cédula y el correo electrónico.', 'error');
  const button = $('#recovery-form button[type="submit"]');
  setBusy(button, true, 'Enviando…');
  try {
    await requestPasswordRecovery(cedula, email);
    showAuthMessage('Si la información coincide con una cuenta activa, recibirá las instrucciones en su correo electrónico.', 'success');
    $('#recovery-form').reset();
  } catch {
    showAuthMessage('Si la información coincide con una cuenta activa, recibirá las instrucciones en su correo electrónico.', 'success');
  } finally {
    setBusy(button, false, 'Enviar instrucciones');
  }
}

function toggleRecovery(show) {
  $('#login-form').classList.toggle('hidden', show);
  $('#recovery-form').classList.toggle('hidden', !show);
  $('#auth-message').classList.add('hidden');
}

async function openApplication() {
  state.api = new ApiService();
  state.profile = await state.api.profile();
  const role = assertAllowedRole(state.profile.rol);
  document.body.dataset.role = role;
  $$('[class*="role-"]').forEach((element) => {
    const allowed = element.classList.contains(`role-${role}`);
    element.classList.toggle('hidden', !allowed);
  });
  $('#user-name').textContent = state.profile.nombre_completo;
  $('#user-role').textContent = roleLabel(role);
  $('#user-initials').textContent = initials(state.profile.nombre_completo);
  $('#welcome-name').textContent = `Buenos días, ${state.profile.nombre_completo.split(' ')[0]}`;
  $('#login-view').classList.add('hidden');
  $('#app-view').classList.remove('hidden');
  navigate('dashboard');
  await loadDashboard();
  if (state.profile.requiere_cambio_clave) openRequiredPasswordDialog();
}

function openRequiredPasswordDialog() {
  const dialog = $('#entity-dialog');
  const closeForm = dialog.querySelector(':scope > form');
  closeForm.classList.add('hidden');
  const preventClose = (event) => event.preventDefault();
  dialog.addEventListener('cancel', preventClose);
  const content = $('#entity-dialog-content'); content.replaceChildren();
  const title = document.createElement('h2'); title.textContent = 'Cambie su contraseña temporal';
  const description = document.createElement('p'); description.className = 'muted'; description.textContent = 'Para continuar, establezca una contraseña de al menos 10 caracteres con mayúscula, minúscula, número y símbolo.';
  const form = document.createElement('form'); form.className = 'form-grid';
  const first = div('field span-2'); const firstLabel = document.createElement('label'); firstLabel.textContent = 'Nueva contraseña'; const firstInput = document.createElement('input'); firstInput.type = 'password'; firstInput.autocomplete = 'new-password'; firstInput.required = true; first.append(firstLabel, firstInput);
  const second = div('field span-2'); const secondLabel = document.createElement('label'); secondLabel.textContent = 'Confirmar contraseña'; const secondInput = document.createElement('input'); secondInput.type = 'password'; secondInput.autocomplete = 'new-password'; secondInput.required = true; second.append(secondLabel, secondInput);
  const actions = div('form-actions span-2'); const save = button('Guardar nueva contraseña', 'button button-primary'); save.type = 'submit'; actions.append(save); form.append(first, second, actions);
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); const validation = validatePassword(firstInput.value);
    if (!validation.valid) return toast(`La contraseña debe incluir ${validation.errors.join(', ')}.`, 'error');
    if (firstInput.value !== secondInput.value) return toast('Las contraseñas no coinciden.', 'error');
    setBusy(save, true, 'Guardando…');
    try {
      const { data: { session } } = await state.api.supabase.auth.getSession();
      await invokePublicFunction(APP_CONFIG.functionNames.changePassword, { password: firstInput.value }, session.access_token);
      state.profile.requiere_cambio_clave = false;
      dialog.removeEventListener('cancel', preventClose); closeForm.classList.remove('hidden'); dialog.close();
      toast('Su contraseña fue actualizada.', 'success');
    } catch (error) { toast(readableError(error), 'error'); }
    finally { setBusy(save, false, 'Guardar nueva contraseña'); }
  });
  content.append(title, description, form); dialog.showModal();
}

async function handleLogout() {
  try { await signOut(); } catch (error) { toast(readableError(error), 'error'); }
  window.location.reload();
}

function navigate(viewName) {
  const target = $(`#view-${viewName}`);
  if (!target || target.classList.contains('hidden') && target.classList.contains('role-administrador') && state.profile?.rol !== 'administrador') return;
  $$('.app-view-section').forEach((section) => section.classList.add('hidden'));
  target.classList.remove('hidden');
  $$('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === viewName));
  const titles = { dashboard: 'Resumen', students: 'Estudiantes', justifications: 'Registrar justificación', users: 'Usuarios', imports: 'Importar y respaldar', audit: 'Auditoría' };
  $('#page-title').textContent = titles[viewName] || 'Sistema';
  $('#sidebar').classList.remove('open');
  if (viewName === 'users') loadUsers();
  if (viewName === 'audit') loadAudit();
}

async function loadDashboard() {
  try {
    const data = await state.api.dashboard(APP_CONFIG.currentAcademicYear);
    $('#stat-students').textContent = data.students.toLocaleString('es-CR');
    $('#stat-justifications').textContent = data.justifications.toLocaleString('es-CR');
    $('#stat-lessons').textContent = data.lessons.toLocaleString('es-CR');
    if (data.users !== null) $('#stat-users').textContent = data.users.toLocaleString('es-CR');
  } catch (error) { toast(readableError(error), 'error'); }
}

async function searchStudents() {
  const container = $('#student-results');
  container.replaceChildren(loadingState());
  try {
    const students = await state.api.searchStudents({
      term: $('#student-search').value,
      level: $('#student-level-filter').value,
      section: $('#student-section-filter').value,
      year: APP_CONFIG.currentAcademicYear
    });
    $('#student-result-count').textContent = String(students.length);
    container.replaceChildren();
    if (!students.length) return container.append(emptyState('Sin resultados', 'No se encontraron estudiantes con esos criterios.'));
    students.forEach((student) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'result-item';
      const identity = document.createElement('div');
      const strong = document.createElement('strong'); strong.textContent = fullStudentName(student);
      const meta = document.createElement('span'); meta.textContent = `${student.cedula} · Sección ${student.seccion}`;
      identity.append(strong, meta);
      const arrow = document.createElement('span'); arrow.textContent = 'Ver →';
      button.append(identity, arrow);
      button.addEventListener('click', () => selectStudent(student.id, button));
      container.append(button);
    });
  } catch (error) {
    container.replaceChildren(emptyState('No fue posible buscar', readableError(error)));
  }
}

async function selectStudent(studentId, button) {
  $$('.result-item').forEach((item) => item.classList.toggle('active', item === button));
  const detail = $('#student-detail');
  detail.replaceChildren(loadingState());
  try {
    const data = await state.api.studentWithJustifications(studentId, APP_CONFIG.currentAcademicYear);
    state.selectedStudent = data.student;
    state.currentJustifications = data.justifications;
    renderStudentDetail(data.student, data.justifications);
  } catch (error) { detail.replaceChildren(emptyState('No fue posible cargar el expediente', readableError(error))); }
}

function renderStudentDetail(student, records) {
  const detail = $('#student-detail');
  detail.replaceChildren();
  const identity = div('student-identity');
  const heading = document.createElement('div');
  const name = document.createElement('h3'); name.textContent = fullStudentName(student);
  const sub = document.createElement('p'); sub.className = 'muted'; sub.textContent = `Cédula ${student.cedula}`;
  heading.append(name, sub); identity.append(heading);
  if (state.profile.rol === 'administrador') {
    const actions = div('table-actions');
    actions.append(actionButton('Editar', () => openStudentDialog(student)), actionButton('Eliminar', () => confirmDeleteStudent(student)));
    identity.append(actions);
  }
  detail.append(identity);

  const meta = div('meta-grid');
  meta.append(metaItem('Nivel', student.nivel), metaItem('Sección', student.seccion), metaItem('Curso lectivo', student.curso_lectivo), metaItem('Ciclo educativo', student.ciclo_educativo), metaItem('Estado', student.activo ? 'Activo' : 'Inactivo'));
  detail.append(meta);

  const title = document.createElement('h3'); title.textContent = 'Justificaciones registradas'; detail.append(title);
  if (!records.length) detail.append(emptyState('Sin justificaciones', 'No se encontraron justificaciones de ausencia para este estudiante.'));
  else detail.append(buildJustificationTable(records));
  const totals = totalsByPeriod(records);
  const totalGrid = div('totals-grid');
  totalGrid.append(totalItem('Registros I Periodo', totals.I.records), totalItem('Lecciones I Periodo', totals.I.lessons), totalItem('Registros II Periodo', totals.II.records), totalItem('Lecciones II Periodo', totals.II.lessons), totalItem('Total anual', totals.totalLessons));
  detail.append(totalGrid);
}

function buildJustificationTable(records) {
  const wrap = div('table-wrap');
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const header = document.createElement('tr');
  ['Fecha', 'Lecciones', 'Motivo', 'Periodo', 'Médico', ...(state.profile.rol === 'docente' ? [] : ['Acciones'])].forEach((text) => { const th = document.createElement('th'); th.textContent = text; header.append(th); });
  thead.append(header); table.append(thead);
  const tbody = document.createElement('tbody');
  records.forEach((record) => {
    const row = document.createElement('tr');
    [formatDate(record.fecha_ausencia), record.cantidad_lecciones, record.motivo, `${record.periodo} Periodo`, record.justificante_medico ? 'Sí' : 'No'].forEach((value) => { const td = document.createElement('td'); td.textContent = String(value); row.append(td); });
    if (state.profile.rol !== 'docente') {
      const td = document.createElement('td'); const actions = div('table-actions');
      actions.append(actionButton('Editar', () => editJustification(record)), actionButton('Eliminar', () => confirmDeleteJustification(record)));
      td.append(actions); row.append(td);
    }
    tbody.append(row);
  });
  table.append(tbody); wrap.append(table); return wrap;
}

async function loadStudentSuggestions() {
  const term = $('#justification-student-search').value;
  const container = $('#student-suggestions');
  $('#justification-student-id').value = '';
  if (term.trim().length < 2) return container.classList.add('hidden');
  try {
    const students = await state.api.searchStudents({ term, limit: 8 });
    container.replaceChildren();
    students.forEach((student) => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'suggestion';
      button.textContent = `${fullStudentName(student)} · ${student.cedula} · ${student.seccion}`;
      button.addEventListener('click', () => {
        $('#justification-student-id').value = student.id;
        $('#justification-student-search').value = `${fullStudentName(student)} · ${student.seccion}`;
        container.classList.add('hidden');
      });
      container.append(button);
    });
    container.classList.toggle('hidden', students.length === 0);
  } catch { container.classList.add('hidden'); }
}

async function saveJustification(event) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity() || !$('#justification-student-id').value) return toast('Seleccione un estudiante de la lista de resultados.', 'error');
  const payload = {
    id: $('#justification-id').value || null,
    student_id: $('#justification-student-id').value,
    fecha_ausencia: $('#absence-date').value,
    cantidad_lecciones: $('#lesson-count').value,
    motivo: $('#reason').value,
    periodo: $('#period').value,
    justificante_medico: $('#medical-proof').value === 'true',
    observacion: $('#observation').value,
    curso_lectivo: APP_CONFIG.currentAcademicYear
  };
  const button = form.querySelector('button[type="submit"]'); setBusy(button, true, 'Guardando…');
  try { await state.api.saveJustification(payload); toast('La justificación fue guardada correctamente.', 'success'); resetJustificationForm(); await loadDashboard(); }
  catch (error) { toast(readableError(error), 'error'); }
  finally { setBusy(button, false, 'Guardar justificación'); }
}

function editJustification(record) {
  navigate('justifications');
  $('#justification-id').value = record.id;
  $('#justification-student-id').value = record.student_id;
  $('#justification-student-search').value = fullStudentName(state.selectedStudent);
  $('#absence-date').value = record.fecha_ausencia;
  $('#lesson-count').value = record.cantidad_lecciones;
  $('#period').value = record.periodo;
  $('#medical-proof').value = String(record.justificante_medico);
  $('#reason').value = record.motivo;
  $('#observation').value = record.observacion || '';
  $('#reason-count').textContent = record.motivo.length;
  $('#cancel-justification-edit').classList.remove('hidden');
}

function resetJustificationForm() {
  $('#justification-form').reset();
  $('#justification-id').value = '';
  $('#justification-student-id').value = '';
  $('#reason-count').textContent = '0';
  $('#cancel-justification-edit').classList.add('hidden');
}

function confirmDeleteJustification(record) {
  openConfirm('Eliminar justificación', `Se eliminará la justificación del ${formatDate(record.fecha_ausencia)}. Esta acción quedará registrada en la auditoría.`, async () => {
    await state.api.deleteJustification(record.id);
    toast('Justificación eliminada.', 'success');
    if (state.selectedStudent) await selectStudent(state.selectedStudent.id);
    await loadDashboard();
  });
}

function openStudentDialog(student = null) {
  const content = $('#entity-dialog-content');
  content.replaceChildren();
  const title = document.createElement('h2'); title.textContent = student ? 'Modificar estudiante' : 'Nuevo estudiante';
  const form = document.createElement('form'); form.className = 'form-grid'; form.id = 'student-dialog-form';
  const fields = [
    ['cedula', 'Cédula', 'text'], ['nombre', 'Nombre', 'text'], ['primer_apellido', 'Primer apellido', 'text'], ['segundo_apellido', 'Segundo apellido', 'text'],
    ['nivel', 'Nivel', 'select'], ['seccion', 'Sección', 'text'], ['curso_lectivo', 'Curso lectivo', 'number'], ['activo', 'Estado', 'select-status']
  ];
  fields.forEach(([name, labelText, type]) => {
    const field = div('field'); const label = document.createElement('label'); label.htmlFor = `student-${name}`; label.textContent = labelText;
    let input;
    if (type.startsWith('select')) {
      input = document.createElement('select');
      const options = type === 'select-status' ? [['true','Activo'],['false','Inactivo']] : [['','Seleccione'], ...[7,8,9,10,11,12].map((v) => [v,v])];
      options.forEach(([value,text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); });
    } else { input = document.createElement('input'); input.type = type; }
    input.id = `student-${name}`; input.name = name; input.required = name !== 'segundo_apellido';
    if (name === 'seccion') input.pattern = '([7-9]|1[0-2])-[1-6]';
    field.append(label, input); form.append(field);
  });
  const actions = div('form-actions span-2');
  const cancel = button('Cancelar', 'button button-secondary'); cancel.type = 'button'; cancel.addEventListener('click', () => $('#entity-dialog').close());
  const save = button('Guardar estudiante', 'button button-primary'); save.type = 'submit'; actions.append(cancel, save); form.append(actions);
  if (student) for (const [key, value] of Object.entries(student)) { const input = form.elements.namedItem(key); if (input) input.value = String(value); }
  else { form.elements.namedItem('curso_lectivo').value = APP_CONFIG.currentAcademicYear; form.elements.namedItem('activo').value = 'true'; }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const values = Object.fromEntries(new FormData(form)); values.id = student?.id; values.activo = values.activo === 'true';
    if (educationCycle(values.nivel) === '' || !new RegExp(`^${values.nivel}-[1-6]$`).test(values.seccion)) return toast('La sección debe corresponder al nivel y terminar entre 1 y 6.', 'error');
    setBusy(save, true, 'Guardando…');
    try { await state.api.saveStudent(values); $('#entity-dialog').close(); toast('Estudiante guardado.', 'success'); await searchStudents(); await loadDashboard(); }
    catch (error) { toast(readableError(error), 'error'); }
    finally { setBusy(save, false, 'Guardar estudiante'); }
  });
  content.append(title, form); $('#entity-dialog').showModal();
}

function confirmDeleteStudent(student) {
  openConfirm('Eliminar estudiante', `Se eliminará a ${fullStudentName(student)}. Si tiene justificaciones relacionadas, la base de datos impedirá la eliminación y deberá desactivarlo.`, async () => {
    await state.api.deleteStudent(student.id); toast('Estudiante eliminado.', 'success'); $('#student-detail').replaceChildren(emptyState('Seleccione un estudiante', 'Aquí aparecerá su información.')); await searchStudents();
  });
}

async function loadUsers() {
  const body = $('#users-table-body'); body.replaceChildren(tableLoadingRow(6));
  try {
    const users = await state.api.listUsers($('#user-search').value, $('#user-role-filter').value);
    body.replaceChildren();
    if (!users.length) return body.append(tableMessageRow('No se encontraron usuarios.', 6));
    users.forEach((user) => {
      const row = document.createElement('tr');
      [user.nombre_completo, user.cedula, user.correo, roleLabel(user.rol)].forEach((value) => { const td = document.createElement('td'); td.textContent = value; row.append(td); });
      const status = document.createElement('td'); const pill = document.createElement('span'); pill.className = `status-pill ${user.activo ? 'active' : 'inactive'}`; pill.textContent = user.activo ? 'Activo' : 'Inactivo'; status.append(pill); row.append(status);
      const actionsCell = document.createElement('td'); const actions = div('table-actions'); actions.append(actionButton('Editar', () => openUserDialog(user)), actionButton(user.activo ? 'Desactivar' : 'Activar', () => toggleUser(user))); actionsCell.append(actions); row.append(actionsCell); body.append(row);
    });
  } catch (error) { body.replaceChildren(tableMessageRow(readableError(error), 6)); }
}

function openUserDialog(user = null) {
  const content = $('#entity-dialog-content'); content.replaceChildren();
  const title = document.createElement('h2'); title.textContent = user ? 'Modificar usuario' : 'Nuevo usuario';
  const form = document.createElement('form'); form.className = 'form-grid';
  const specifications = [
    ['cedula','Cédula','text'], ['nombre_completo','Nombre completo','text'], ['correo','Correo electrónico','email'], ['rol','Rol','role'], ['activo','Estado','status']
  ];
  if (!user) specifications.push(['temporary_password','Contraseña temporal de 8 dígitos','password']);
  specifications.forEach(([name,labelText,type]) => {
    const field = div(name === 'nombre_completo' ? 'field span-2' : 'field'); const label = document.createElement('label'); label.textContent = labelText; label.htmlFor = `user-${name}`;
    let input;
    if (type === 'role' || type === 'status') {
      input = document.createElement('select');
      const options = type === 'role' ? [['docente','Docente'],['auxiliar','Auxiliar'],['administrador','Administrador']] : [['true','Activo'],['false','Inactivo']];
      options.forEach(([value,text]) => { const option = document.createElement('option'); option.value = value; option.textContent = text; input.append(option); });
    } else { input = document.createElement('input'); input.type = type; }
    input.id = `user-${name}`; input.name = name; input.required = true;
    if (name === 'temporary_password') { input.inputMode = 'numeric'; input.pattern = '\\d{8}'; input.maxLength = 8; }
    field.append(label, input); form.append(field);
  });
  const actions = div('form-actions span-2'); const cancel = button('Cancelar', 'button button-secondary'); cancel.type = 'button'; cancel.addEventListener('click', () => $('#entity-dialog').close()); const save = button('Guardar usuario', 'button button-primary'); save.type = 'submit'; actions.append(cancel, save); form.append(actions);
  if (user) for (const [key,value] of Object.entries(user)) { const input = form.elements.namedItem(key); if (input) input.value = String(value); }
  form.addEventListener('submit', async (event) => {
    event.preventDefault(); if (!form.reportValidity()) return;
    const payload = Object.fromEntries(new FormData(form)); payload.id = user?.id; payload.activo = payload.activo === 'true';
    setBusy(save, true, 'Guardando…');
    try { await state.api.adminUser(user ? 'update' : 'create', payload); $('#entity-dialog').close(); toast('Usuario guardado.', 'success'); await loadUsers(); }
    catch (error) { toast(readableError(error), 'error'); }
    finally { setBusy(save, false, 'Guardar usuario'); }
  });
  content.append(title, form); $('#entity-dialog').showModal();
}

function toggleUser(user) {
  openConfirm(user.activo ? 'Desactivar usuario' : 'Activar usuario', `${user.nombre_completo} ${user.activo ? 'no podrá ingresar al sistema' : 'recuperará el acceso según su rol'}.`, async () => {
    await state.api.adminUser('update', { id: user.id, activo: !user.activo }); toast('Estado del usuario actualizado.', 'success'); await loadUsers();
  });
}

async function prepareImport(file, type) {
  try {
    const rows = await readImportFile(file);
    const validation = type === 'students' ? validateStudentRows(rows) : validateUserRows(rows);
    state.import = { type, validation };
    renderImportPreview();
  } catch (error) { toast(readableError(error), 'error'); }
}

function renderImportPreview() {
  const { validation } = state.import;
  $('#import-preview-panel').classList.remove('hidden');
  $('#import-summary').className = `notice ${validation.invalidRows.length ? 'error' : 'success'}`;
  $('#import-summary').textContent = `${validation.validRows.length} filas válidas y ${validation.invalidRows.length} filas con errores.`;
  const head = $('#import-preview-head'); const body = $('#import-preview-body'); head.replaceChildren(); body.replaceChildren();
  const headers = ['Fila', ...validation.headers.slice(0, 8), 'Resultado'];
  const headerRow = document.createElement('tr'); headers.forEach((text) => { const th = document.createElement('th'); th.textContent = text; headerRow.append(th); }); head.append(headerRow);
  [...validation.invalidRows, ...validation.validRows].slice(0, 50).forEach((entry) => {
    const row = document.createElement('tr'); const values = [entry.row, ...validation.headers.slice(0, 8).map((key) => entry.data[key]), entry.errors.length ? entry.errors.join('; ') : 'Correcto'];
    values.forEach((value) => { const td = document.createElement('td'); td.textContent = String(value ?? ''); row.append(td); }); body.append(row);
  });
  $('#confirm-import').disabled = validation.invalidRows.length > 0 || validation.validRows.length === 0;
  $('#import-preview-panel').scrollIntoView({ behavior: 'smooth' });
}

async function confirmImport() {
  if (!state.import) return;
  const buttonElement = $('#confirm-import'); setBusy(buttonElement, true, 'Importando…');
  try {
    const rows = state.import.validation.validRows.map((entry) => entry.data);
    if (state.import.type === 'students') {
      await state.api.importStudents(rows);
      toast(`${rows.length} estudiantes fueron importados.`, 'success');
    } else {
      const result = await state.api.adminUser('bulk_create', { users: rows });
      if (result.credentials?.length) {
        downloadText(`credenciales-temporales-${new Date().toISOString().slice(0,10)}.csv`, toCsv(result.credentials));
      }
      toast(`${result.created || 0} usuarios creados${result.errors?.length ? `; ${result.errors.length} filas presentaron errores.` : '.'}`, result.errors?.length ? 'error' : 'success');
    }
    clearImport(); await loadDashboard();
  } catch (error) { toast(readableError(error), 'error'); }
  finally { setBusy(buttonElement, false, 'Confirmar importación'); }
}

function clearImport() {
  state.import = null; $('#import-preview-panel').classList.add('hidden'); $('#student-import-file').value = ''; $('#user-import-file').value = '';
}

async function exportTable(tableName) {
  try {
    const rows = await state.api.exportTable(tableName);
    downloadText(`${tableName}-${new Date().toISOString().slice(0,10)}.csv`, toCsv(rows));
    toast('Respaldo descargado.', 'success');
  } catch (error) { toast(readableError(error), 'error'); }
}

async function loadAudit() {
  const body = $('#audit-table-body'); body.replaceChildren(tableLoadingRow(5));
  try {
    const rows = await state.api.audit(); body.replaceChildren();
    if (!rows.length) return body.append(tableMessageRow('No hay eventos de auditoría.', 5));
    rows.forEach((entry) => {
      const row = document.createElement('tr');
      [formatDate(entry.created_at, { hour: '2-digit', minute: '2-digit' }), entry.profile?.nombre_completo || 'Sistema', entry.accion, entry.entidad, entry.registro_id || '—'].forEach((value) => { const td = document.createElement('td'); td.textContent = value; row.append(td); });
      body.append(row);
    });
  } catch (error) { body.replaceChildren(tableMessageRow(readableError(error), 5)); }
}

function openConfirm(title, message, action) {
  $('#confirm-title').textContent = title; $('#confirm-message').textContent = message; state.confirmAction = action; $('#confirm-dialog').showModal();
}
function closeConfirm() { state.confirmAction = null; $('#confirm-dialog').close(); }
async function runConfirmedAction() {
  const action = state.confirmAction; if (!action) return closeConfirm(); const accept = $('#confirm-accept'); setBusy(accept, true, 'Procesando…');
  try { await action(); closeConfirm(); } catch (error) { toast(readableError(error), 'error'); }
  finally { setBusy(accept, false, 'Confirmar'); }
}

function showAuthMessage(message, type = '') { const box = $('#auth-message'); box.textContent = message; box.className = `notice ${type}`; }
function toast(message, type = '') { const item = div(`toast ${type}`); item.textContent = message; $('#toast-region').append(item); setTimeout(() => item.remove(), 5000); }
function readableError(error) {
  const message = String(error?.message || error || 'Ocurrió un error inesperado.');
  if (/row-level security|permission denied|not authorized|403/i.test(message)) return 'No tiene permisos para realizar esta acción.';
  if (/duplicate key|unique constraint/i.test(message)) return 'Ya existe un registro con esa cédula, correo o combinación de datos.';
  if (/failed to fetch|network/i.test(message)) return 'No fue posible comunicarse con el servidor. Revise la conexión.';
  return message;
}
function setBusy(element, busy, label) { element.disabled = busy; element.textContent = label; }
function div(className = '') { const element = document.createElement('div'); element.className = className; return element; }
function button(label, className = 'button') { const element = document.createElement('button'); element.textContent = label; element.className = className; return element; }
function actionButton(label, handler) { const element = button(label, 'button button-secondary'); element.type = 'button'; element.addEventListener('click', handler); return element; }
function emptyState(title, description) { const element = div('empty-state'); const strong = document.createElement('strong'); strong.textContent = title; const span = document.createElement('span'); span.textContent = description; element.append(strong, span); return element; }
function loadingState() { return emptyState('Cargando…', 'Espere un momento.'); }
function metaItem(label, value) { const item = div('meta-item'); const span = document.createElement('span'); span.textContent = label; const strong = document.createElement('strong'); strong.textContent = String(value ?? '—'); item.append(span, strong); return item; }
function totalItem(label, value) { const item = div('total-item'); const span = document.createElement('span'); span.textContent = label; const strong = document.createElement('strong'); strong.textContent = Number(value || 0).toLocaleString('es-CR'); item.append(span, strong); return item; }
function tableLoadingRow(colspan) { return tableMessageRow('Cargando…', colspan); }
function tableMessageRow(message, colspan) { const row = document.createElement('tr'); const cell = document.createElement('td'); cell.colSpan = colspan; cell.textContent = message; cell.className = 'muted'; row.append(cell); return row; }
