-- =====================================================================
-- Inventario Hachiko · Puntos de liga
-- Cada cliente acumula puntos de liga. Cada registro guarda la cantidad,
-- un comentario, la fecha en que se ganaron y quién los asignó. El total
-- es la suma (se permiten negativos para corregir).
-- =====================================================================

create table public.customer_league_points (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  points      integer not null check (points <> 0),
  note        text,
  -- Fecha en que se ganaron (la elige quien los registra; por defecto hoy).
  awarded_on  date not null default current_date,
  -- Mismo id para los puntos dados juntos (varios clientes a la vez).
  batch_id    uuid,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

create index league_points_customer_idx on public.customer_league_points (customer_id, awarded_on desc, created_at desc);
create index league_points_batch_idx on public.customer_league_points (batch_id) where batch_id is not null;

-- ---------- permisos ----------
alter table public.customer_league_points enable row level security;

revoke all on public.customer_league_points from anon, authenticated;
-- Solo lectura e inserción (vía grant_league_points); nada se edita ni se borra.
grant select, insert on public.customer_league_points to authenticated;

create policy "league_points: authenticated puede leer"
  on public.customer_league_points for select to authenticated using (true);
create policy "league_points: authenticated registra como sí mismo"
  on public.customer_league_points for insert to authenticated with check (created_by = auth.uid());

-- ---------- vistas ----------
create view public.customer_league_totals
with (security_invoker = true)
as
select c.id as customer_id, coalesce(sum(p.points), 0)::integer as points
from public.customers c
left join public.customer_league_points p on p.customer_id = c.id
group by c.id;

create view public.league_points_history
with (security_invoker = true)
as
select
  p.id,
  p.customer_id,
  p.points,
  p.note,
  p.awarded_on,
  p.batch_id,
  p.created_at,
  p.created_by,
  pr.email     as created_by_email,
  pr.full_name as created_by_name
from public.customer_league_points p
left join public.profiles pr on pr.id = p.created_by;

revoke all on public.customer_league_totals, public.league_points_history from anon, authenticated;
grant select on public.customer_league_totals, public.league_points_history to authenticated;

-- ---------------------------------------------------------------------
-- grant_league_points: da puntos a uno o varios clientes con la misma
-- fecha y comentario.
--   p_grants: [{ "customer_id": "...", "points": 3 }, ...]
--   p_batch_id lo genera la app: si se reintenta, no se duplica.
-- status: 'ok' | 'duplicate'
-- ---------------------------------------------------------------------
create function public.grant_league_points(p_batch_id uuid, p_awarded_on date, p_note text, p_grants jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_total integer;
begin
  select count(*), coalesce(sum(points), 0) into v_count, v_total
  from public.customer_league_points where batch_id = p_batch_id;
  if v_count > 0 then
    return jsonb_build_object('status', 'duplicate', 'count', v_count, 'total', v_total);
  end if;

  if p_grants is null or jsonb_typeof(p_grants) <> 'array' or jsonb_array_length(p_grants) = 0 then
    raise exception 'No hay puntos que agregar' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_grants) as g(customer_id uuid, points integer)
    where g.customer_id is null or g.points is null or g.points = 0
  ) then
    raise exception 'Hay cantidades inválidas (deben ser enteros distintos de 0)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_grants) as g(customer_id uuid)
    where not exists (select 1 from public.customers c where c.id = g.customer_id)
  ) then
    raise exception 'Uno de los clientes no existe' using errcode = 'P0002';
  end if;

  insert into public.customer_league_points (customer_id, points, note, awarded_on, batch_id, created_by)
  select g.customer_id, g.points, nullif(btrim(coalesce(p_note, '')), ''), coalesce(p_awarded_on, current_date), p_batch_id, auth.uid()
  from jsonb_to_recordset(p_grants) as g(customer_id uuid, points integer);

  get diagnostics v_count = row_count;
  select coalesce(sum(points), 0) into v_total from public.customer_league_points where batch_id = p_batch_id;
  return jsonb_build_object('status', 'ok', 'count', v_count, 'total', v_total);
end;
$$;

revoke all on function public.grant_league_points(uuid, date, text, jsonb) from public, anon;
grant execute on function public.grant_league_points(uuid, date, text, jsonb) to authenticated;
