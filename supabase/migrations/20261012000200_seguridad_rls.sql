-- =====================================================================
-- Inventario Hachiko · Fase 1 · Permisos y RLS
-- Regla general: `anon` no tiene acceso a nada; `authenticated` opera.
-- =====================================================================

alter table public.profiles            enable row level security;
alter table public.products            enable row level security;
alter table public.inventory_movements enable row level security;

-- Supabase da por defecto privilegios a anon/authenticated sobre tablas nuevas.
-- Los quitamos y concedemos explícitamente solo lo necesario (defensa en profundidad,
-- además de RLS).
revoke all on public.profiles, public.products, public.inventory_movements from anon, authenticated;
revoke all on sequence public.internal_code_seq from anon, authenticated;

grant select                 on public.profiles            to authenticated;
grant select, insert, update on public.products            to authenticated;
-- Movimientos append-only: sin UPDATE ni DELETE desde el cliente.
grant select, insert         on public.inventory_movements to authenticated;
-- create_product (SECURITY INVOKER) necesita nextval() sobre la secuencia.
grant usage                  on sequence public.internal_code_seq to authenticated;

-- ---------- profiles ----------
-- Cualquier usuario autenticado puede leer los perfiles (equipo pequeño; se usa
-- para mostrar "quién lo hizo" en el historial). Altas solo vía trigger.
create policy "profiles: authenticated puede leer"
  on public.profiles for select to authenticated
  using (true);

-- ---------- products ----------
-- Sin política DELETE: los productos solo se borran desde el dashboard.
create policy "products: authenticated puede leer"
  on public.products for select to authenticated
  using (true);

create policy "products: authenticated puede crear"
  on public.products for insert to authenticated
  with check (created_by is null or created_by = auth.uid());

create policy "products: authenticated puede actualizar"
  on public.products for update to authenticated
  using (true) with check (true);

-- ---------- inventory_movements ----------
create policy "movements: authenticated puede leer"
  on public.inventory_movements for select to authenticated
  using (true);

-- El autor siempre es quien hace la petición.
create policy "movements: authenticated puede insertar como sí mismo"
  on public.inventory_movements for insert to authenticated
  with check (created_by = auth.uid());
