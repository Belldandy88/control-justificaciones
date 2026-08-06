# Seguridad

Este sistema procesa información de estudiantes menores de edad. No publique datos reales, copias de bases de datos, contraseñas, tokens ni claves secretas en GitHub.

## Reporte de vulnerabilidades

Reporte cualquier vulnerabilidad de forma privada al responsable técnico institucional. No abra un issue público con datos personales, capturas de expedientes o credenciales.

## Controles principales

- Autenticación administrada por Supabase Auth.
- Autorización en PostgreSQL mediante Row Level Security.
- Operaciones administrativas mediante Edge Functions autenticadas.
- Claves secretas limitadas al servidor.
- Auditoría de altas, modificaciones y eliminaciones.
- Respuestas genéricas en acceso y recuperación para impedir enumeración de cuentas.
- Bloqueo temporal después de intentos fallidos.
- Contraseña numérica de ocho dígitos utilizada solo como credencial temporal.

Antes de producción, revise los asesores de seguridad y rendimiento de Supabase, configure SMTP institucional, CAPTCHA, MFA para administradores y una política institucional de conservación de datos.
