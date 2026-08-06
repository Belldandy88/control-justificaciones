# Sistema de Justificaciones de Ausencias — CTP Cañas

Aplicación web para consultar, registrar y administrar justificaciones de ausencias del estudiantado. La interfaz se publica en GitHub Pages y los datos se protegen con Supabase Auth, PostgreSQL, Edge Functions y Row Level Security.

## Funciones

- Acceso por cédula y contraseña.
- Recuperación de contraseña con cédula y correo registrado.
- Docente: consulta de estudiantes, historial y totales por periodo.
- Auxiliar: creación, modificación y eliminación de justificaciones.
- Administrador: padrón, usuarios, importación, respaldos y auditoría.
- Importación CSV o Excel con validación previa.
- Diseño adaptable a computadora, tableta y teléfono.

## Arquitectura

- `index.html`: aplicación principal.
- `reset.html`: recuperación de contraseña.
- `css/` y `js/`: interfaz y lógica del navegador.
- `supabase/migrations/`: tablas, restricciones, RLS y auditoría.
- `supabase/functions/`: autenticación por cédula y operaciones protegidas.
- `templates/`: plantillas para importaciones.

## 1. Crear o seleccionar un proyecto Supabase

Use un proyecto exclusivo para este sistema. No reutilice una base de producción de otra aplicación educativa.

Copie el identificador del proyecto y ajuste `project_id` en `supabase/config.toml`.

## 2. Aplicar la base de datos

Con Supabase CLI autenticado:

```bash
supabase link --project-ref SU_PROJECT_REF
supabase db push
```

También puede copiar el contenido de `supabase/migrations/202608060001_initial_schema.sql` en el SQL Editor. Revise todo el script antes de ejecutarlo.

Los datos de `supabase/seed.sql` son ficticios y opcionales.

## 3. Configurar funciones de servidor

Configure los secretos. Supabase normalmente proporciona las variables heredadas `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`; el código también admite las claves modernas:

```bash
supabase secrets set \
  SUPABASE_PUBLISHABLE_KEY="sb_publishable_..." \
  SUPABASE_SECRET_KEY="sb_secret_..." \
  ALLOWED_ORIGINS="https://belldandy88.github.io,http://localhost:8000" \
  RATE_LIMIT_SALT="VALOR_ALEATORIO_LARGO"
```

Despliegue las funciones:

```bash
supabase functions deploy sign-in-by-cedula
supabase functions deploy recover-account
supabase functions deploy admin-users
supabase functions deploy change-password
```

Nunca coloque `SUPABASE_SECRET_KEY` ni `SUPABASE_SERVICE_ROLE_KEY` en GitHub o en `js/config.js`.

## 4. Crear el primer administrador

El primer administrador se crea una sola vez desde el panel de Supabase:

1. Abra **Authentication → Users → Add user**.
2. Registre el correo real del administrador y una contraseña segura.
3. Copie el UUID del usuario creado.
4. Ejecute este SQL reemplazando todos los valores de ejemplo:

```sql
insert into public.profiles
  (id, cedula, nombre_completo, correo, rol, activo, requiere_cambio_clave)
values
  ('UUID_DE_AUTH', 'CEDULA_SIN_GUIONES', 'NOMBRE COMPLETO', 'correo@institucion.cr',
   'administrador', true, false);

update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"administrador"}'::jsonb
where id = 'UUID_DE_AUTH';
```

No publique este SQL con información real.

## 5. Configurar recuperación de contraseña

En **Authentication → URL Configuration** agregue:

```text
https://belldandy88.github.io/control-justificaciones/reset.html
```

Configure SMTP institucional en Supabase antes de utilizar el sistema con usuarios reales. Active CAPTCHA y revise los límites de Auth.

## 6. Conectar el frontend

En `js/config.js` reemplace:

```js
supabaseUrl: 'https://SU_PROJECT_REF.supabase.co',
supabasePublishableKey: 'sb_publishable_...'
```

La clave publicable puede estar en el navegador porque RLS verifica los permisos. La clave secreta nunca puede publicarse.

## 7. Probar localmente

No abra `index.html` con doble clic. Use un servidor local:

```bash
python -m http.server 8000
```

Abra `http://localhost:8000`.

Ejecute las pruebas:

```bash
npm test
npm run check
```

## 8. Publicar en GitHub Pages

El flujo `.github/workflows/pages.yml` publica cada cambio de `main`.

En GitHub:

1. Abra **Settings → Pages**.
2. En **Build and deployment**, seleccione **GitHub Actions**.
3. Abra **Actions** y verifique que “Publicar en GitHub Pages” finalice correctamente.

Dirección esperada:

```text
https://belldandy88.github.io/control-justificaciones/
```

## Lista mínima antes de producción

- RLS activo en todas las tablas expuestas.
- Asesores de seguridad y rendimiento de Supabase sin hallazgos críticos.
- Docente bloqueado para crear, modificar y eliminar.
- Auxiliar bloqueado para administrar usuarios y padrón.
- Administrador protegido con MFA.
- SMTP, CAPTCHA y redirecciones configurados.
- Datos de prueba eliminados.
- Ninguna clave secreta en el historial de Git.
- Respaldo y política institucional de conservación aprobados.
- Pruebas en computadora y teléfono completadas.

## Dependencias del navegador

Las versiones se encuentran fijadas para reducir cambios inesperados:

- `@supabase/supabase-js` 2.57.4.
- `xlsx` 0.18.5.

Revise y actualice estas dependencias de forma controlada cuando existan correcciones de seguridad.
