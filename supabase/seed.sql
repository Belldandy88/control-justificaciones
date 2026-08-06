-- Datos completamente ficticios para pruebas. Ejecute únicamente después de crear usuarios Auth y perfiles.
insert into public.students
  (cedula, nombre, primer_apellido, segundo_apellido, nivel, seccion, curso_lectivo, ciclo_educativo, activo)
values
  ('900000001', 'Daniela', 'Araya', 'Solano', 7, '7-1', extract(year from current_date)::smallint, 'III Ciclo', true),
  ('900000002', 'Mateo', 'Brenes', 'Vargas', 9, '9-2', extract(year from current_date)::smallint, 'III Ciclo', true),
  ('900000003', 'Valeria', 'Campos', 'Rojas', 10, '10-3', extract(year from current_date)::smallint, 'Educación Diversificada', true),
  ('900000004', 'Sebastián', 'Jiménez', 'Mora', 12, '12-3', extract(year from current_date)::smallint, 'Educación Diversificada', true)
on conflict (cedula, curso_lectivo) do nothing;
