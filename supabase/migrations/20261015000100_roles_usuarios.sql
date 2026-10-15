-- =====================================================================
-- Inventario Hachiko · Roles y usuarios
--
-- Dos roles:
--   admin      → todo, incluido dar de alta productos, sumar/fijar stock,
--                deshacer movimientos, editar productos y administrar usuarios.
--   mostrador  → todo lo demás (vender, clientes, créditos, puntos de liga),
--                pero NO puede agregar ni modificar el inventario.
--
-- Las ventas siguen descontando stock para ambos roles (pay_ticket).
-- Los usuarios nuevos se crean con la Edge Function `crear-usuario`
-- (necesita la service_role key, que nunca va en el navegador).
-- =====================================================================

-- 'staff' pasa a llamarse 'mostrador' (los perfiles existentes se renombran solos).
alter type public.user_role rename value 'staff' to 'mostrador';

-- Para no dejar la app sin nadie que pueda administrar: si todavía no hay
-- ningún admin, los usuarios que ya existían pasan a admin (antes todos
-- podían hacer todo). Después se pueden ajustar desde la pantalla Usuarios.
update public.profiles set role = 'admin'
where not exists (select 1 from public.profiles where role = 'admin');

-- ---------- helper ----------
-- SECURITY DEFINER para poder leer el rol sin depender de las políticas de
-- profiles (y para usarlo dentro de políticas sin recursión).
create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ---------- productos: solo admin agrega o edita ----------
-- auth.uid() nulo = SQL Editor / service_role (scripts): no se restringe.
create function public.guard_products()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'Solo un administrador puede dar de alta productos' using errcode = '42501';
  end if;
  -- Mostrador: solo puede cambiar la cantidad (ventas con pay_ticket).
  if (new.barcode, new.name, new.category, new.supplier, new.cost, new.price, new.image_url,
      new.is_internal_code, new.description, new.catalog_product_id)
     is distinct from
     (old.barcode, old.name, old.category, old.supplier, old.cost, old.price, old.image_url,
      old.is_internal_code, old.description, old.catalog_product_id) then
    raise exception 'Solo un administrador puede editar productos' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger products_guard
  before insert or update on public.products
  for each row execute function public.guard_products();

-- ---------- movimientos: solo admin suma, fija o deshace ----------
-- Cubre register_scan, create_product y undo_movement sin reescribirlas: el
-- error deshace también el cambio de cantidad (misma transacción).
create function public.guard_inventory_movements()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.type <> 'sale' and auth.uid() is not null and not public.is_admin() then
    raise exception 'Solo un administrador puede agregar o ajustar inventario' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger inventory_movements_guard
  before insert on public.inventory_movements
  for each row execute function public.guard_inventory_movements();

revoke all on function public.guard_products() from public, anon, authenticated;
revoke all on function public.guard_inventory_movements() from public, anon, authenticated;

-- ---------- profiles: el admin edita nombre y rol ----------
grant update (full_name, role) on public.profiles to authenticated;

create policy "profiles: admin puede actualizar"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Siempre debe quedar al menos un administrador.
create function public.keep_one_admin()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if old.role = 'admin' and new.role <> 'admin'
     and not exists (select 1 from public.profiles where role = 'admin' and id <> old.id) then
    raise exception 'Debe quedar al menos un administrador' using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger profiles_keep_one_admin
  before update of role on public.profiles
  for each row execute function public.keep_one_admin();

revoke all on function public.keep_one_admin() from public, anon, authenticated;
