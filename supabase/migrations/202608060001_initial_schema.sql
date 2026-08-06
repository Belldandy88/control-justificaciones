begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_role as enum ('docente', 'auxiliar', 'administrador');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.education_cycle as enum ('III Ciclo', 'Educación Diversificada');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.academic_period as enum ('I', 'II');
exception when duplicate_object then null; end $$;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.normalize_search_text(input text)
returns text
language sql
immutable
set search_path = ''
as $$
  select trim(regexp_replace(
    translate(lower(coalesce(input, '')), 'áéíóúüñ', 'aeiouun'),
    '[^a-z0-9 -]+', ' ', 'g'
  ));
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  cedula text not null unique check (cedula ~ '^[0-9]{5,20}$'),
  nombre_completo text not null check (char_length(trim(nombre_completo)) between 3 and 160),
  correo text not null unique check (correo = lower(correo)),
  rol public.app_role not null,
  activo boolean not null default true,
  requiere_cambio_clave boolean not null default true,
  search_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  cedula text not null check (cedula ~ '^[0-9]{5,20}$'),
  nombre text not null check (char_length(trim(nombre)) between 1 and 80),
  primer_apellido text not null check (char_length(trim(primer_apellido)) between 1 and 80),
  segundo_apellido text not null default '',
  nivel smallint not null check (nivel between 7 and 12),
  seccion text not null check (seccion ~ '^([7-9]|1[0-2])-[1-6]$'),
  curso_lectivo smallint not null check (curso_lectivo between 2020 and 2100),
  ciclo_educativo public.education_cycle not null,
  activo boolean not null default true,
  search_key text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_identity_year_key unique (cedula, curso_lectivo),
  constraint students_level_section_match check (split_part(seccion, '-', 1)::smallint = nivel),
  constraint students_cycle_match check (
    (nivel between 7 and 9 and ciclo_educativo = 'III Ciclo') or
    (nivel between 10 and 12 and ciclo_educativo = 'Educación Diversificada')
  )
);

create table if not exists public.absence_justifications (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  fecha_ausencia date not null,
  cantidad_lecciones smallint not null check (cantidad_lecciones between 1 and 20),
  motivo text not null check (char_length(trim(motivo)) between 3 and 500),
  periodo public.academic_period not null,
  justificante_medico boolean not null default false,
  observacion text check (observacion is null or char_length(observacion) <= 500),
  curso_lectivo smallint not null check (curso_lectivo between 2020 and 2100),
  created_by uuid not null default auth.uid(),
  updated_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint absence_justifications_created_by_fkey foreign key (created_by) references public.profiles(id) on delete restrict,
  constraint absence_justifications_updated_by_fkey foreign key (updated_by) references public.profiles(id) on delete restrict
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles(id) on delete set null,
  accion text not null check (accion in ('INSERT', 'UPDATE', 'DELETE', 'LOGIN_FAILED', 'LOGIN_BLOCKED', 'BULK_IMPORT')),
  entidad text not null,
  registro_id text,
  valores_anteriores jsonb,
  valores_nuevos jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  curso_lectivo_actual smallint not null check (curso_lectivo_actual between 2020 and 2100),
  nombre_institucion text not null default 'CTP Cañas',
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

insert into public.app_settings (id, curso_lectivo_actual)
values (true, extract(year from current_date)::smallint)
on conflict (id) do nothing;

create table if not exists public.auth_rate_limits (
  identifier_hash text primary key,
  attempts smallint not null default 0,
  window_started_at timestamptz not null default now(),
  blocked_until timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists students_search_key_idx on public.students using gin (to_tsvector('simple', search_key));
create index if not exists students_section_year_idx on public.students (curso_lectivo, nivel, seccion) where activo;
create index if not exists justifications_student_year_idx on public.absence_justifications (student_id, curso_lectivo, periodo, fecha_ausencia desc);
create index if not exists justifications_year_idx on public.absence_justifications (curso_lectivo, fecha_ausencia desc);
create index if not exists profiles_search_key_idx on public.profiles using gin (to_tsvector('simple', search_key));
create index if not exists audit_created_at_idx on public.audit_logs (created_at desc);

create or replace function private.set_profile_search_key()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.search_key := private.normalize_search_text(new.nombre_completo || ' ' || new.cedula || ' ' || new.correo);
  new.correo := lower(trim(new.correo));
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.set_student_derived_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.search_key := private.normalize_search_text(new.nombre || ' ' || new.primer_apellido || ' ' || new.segundo_apellido || ' ' || new.cedula);
  new.ciclo_educativo := case when new.nivel between 7 and 9 then 'III Ciclo'::public.education_cycle else 'Educación Diversificada'::public.education_cycle end;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function private.set_justification_update_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.rol
  from public.profiles p
  where p.id = auth.uid() and p.activo = true
  limit 1;
$$;
revoke all on function private.current_app_role() from public, anon;
grant execute on function private.current_app_role() to authenticated;

create or replace function private.audit_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_id text;
begin
  record_id := coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'));
  insert into public.audit_logs (user_id, accion, entidad, registro_id, valores_anteriores, valores_nuevos)
  values (
    auth.uid(), tg_op, tg_table_name, record_id,
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;
revoke all on function private.audit_change() from public, anon, authenticated;

drop trigger if exists profiles_prepare on public.profiles;
create trigger profiles_prepare before insert or update on public.profiles for each row execute function private.set_profile_search_key();
drop trigger if exists students_prepare on public.students;
create trigger students_prepare before insert or update on public.students for each row execute function private.set_student_derived_fields();
drop trigger if exists justifications_prepare on public.absence_justifications;
create trigger justifications_prepare before update on public.absence_justifications for each row execute function private.set_justification_update_fields();

drop trigger if exists students_audit on public.students;
create trigger students_audit after insert or update or delete on public.students for each row execute function private.audit_change();
drop trigger if exists justifications_audit on public.absence_justifications;
create trigger justifications_audit after insert or update or delete on public.absence_justifications for each row execute function private.audit_change();
drop trigger if exists profiles_audit on public.profiles;
create trigger profiles_audit after insert or update or delete on public.profiles for each row execute function private.audit_change();

alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.absence_justifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.auth_rate_limits enable row level security;

drop policy if exists profiles_read_own_or_admin on public.profiles;
create policy profiles_read_own_or_admin on public.profiles for select to authenticated
using (id = auth.uid() or private.current_app_role() = 'administrador');

drop policy if exists students_read_authenticated_staff on public.students;
create policy students_read_authenticated_staff on public.students for select to authenticated
using (private.current_app_role() is not null);
drop policy if exists students_insert_admin on public.students;
create policy students_insert_admin on public.students for insert to authenticated
with check (private.current_app_role() = 'administrador');
drop policy if exists students_update_admin on public.students;
create policy students_update_admin on public.students for update to authenticated
using (private.current_app_role() = 'administrador') with check (private.current_app_role() = 'administrador');
drop policy if exists students_delete_admin on public.students;
create policy students_delete_admin on public.students for delete to authenticated
using (private.current_app_role() = 'administrador');

drop policy if exists justifications_read_staff on public.absence_justifications;
create policy justifications_read_staff on public.absence_justifications for select to authenticated
using (private.current_app_role() is not null);
drop policy if exists justifications_insert_aux_admin on public.absence_justifications;
create policy justifications_insert_aux_admin on public.absence_justifications for insert to authenticated
with check (private.current_app_role() in ('auxiliar','administrador') and created_by = auth.uid());
drop policy if exists justifications_update_aux_admin on public.absence_justifications;
create policy justifications_update_aux_admin on public.absence_justifications for update to authenticated
using (private.current_app_role() in ('auxiliar','administrador'))
with check (private.current_app_role() in ('auxiliar','administrador'));
drop policy if exists justifications_delete_aux_admin on public.absence_justifications;
create policy justifications_delete_aux_admin on public.absence_justifications for delete to authenticated
using (private.current_app_role() in ('auxiliar','administrador'));

drop policy if exists audit_read_admin on public.audit_logs;
create policy audit_read_admin on public.audit_logs for select to authenticated
using (private.current_app_role() = 'administrador');

drop policy if exists settings_read_staff on public.app_settings;
create policy settings_read_staff on public.app_settings for select to authenticated
using (private.current_app_role() is not null);
drop policy if exists settings_update_admin on public.app_settings;
create policy settings_update_admin on public.app_settings for update to authenticated
using (private.current_app_role() = 'administrador') with check (private.current_app_role() = 'administrador');

revoke all on all tables in schema public from anon;
revoke all on public.profiles, public.audit_logs, public.auth_rate_limits from authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.students to authenticated;
grant select, insert, update, delete on public.absence_justifications to authenticated;
grant select on public.audit_logs to authenticated;
grant select, update on public.app_settings to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;

commit;
