-- =====================================================================
-- Configuración del negocio (una fila por base de datos)
--
-- Cada cliente tiene su propio proyecto de Supabase con el mismo esquema.
-- Lo que cambia entre clientes vive aquí:
--   business_name         Nombre que muestra la app ("Inventario <nombre>").
--   internal_code_prefix  Prefijo de los códigos internos (HCH-000001).
--                         Se fija al dar de alta al cliente
--                         (scripts/clientes.mjs alta) y ya no cambia en cuanto
--                         exista un producto con código interno: las etiquetas
--                         impresas lo llevan.
--
-- create_product y unlink_product dejan de tener 'HCH-' fijo y usan
-- _new_internal_code() / _check_reserved_barcode().
-- =====================================================================

create table public.app_settings (
  id                   boolean primary key default true check (id),  -- una sola fila
  business_name        text not null check (length(btrim(business_name)) > 0),
  internal_code_prefix text not null check (internal_code_prefix ~ '^[A-Z]{2,5}$'),
  updated_at           timestamptz not null default now()
);

create trigger app_settings_set_updated_at
  before update on public.app_settings
  for each row execute function public.set_updated_at();

-- Bases que ya estaban en uso (Hachiko) conservan sus códigos HCH-. En una
-- base nueva el alta del cliente pone el nombre y el prefijo correctos.
insert into public.app_settings (business_name, internal_code_prefix)
values (
  case when exists (select 1 from public.products) then 'Hachiko' else 'Mi negocio' end,
  'HCH'
);

-- El prefijo no cambia si ya hay códigos internos impresos con el anterior.
create function public.guard_app_settings()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.internal_code_prefix is distinct from old.internal_code_prefix
     and exists (select 1 from public.products where is_internal_code) then
    raise exception 'El prefijo de códigos internos ya no se puede cambiar: hay productos con código %-',
      old.internal_code_prefix using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger app_settings_guard
  before update on public.app_settings
  for each row execute function public.guard_app_settings();

revoke all on function public.guard_app_settings() from public, anon, authenticated;

-- ---------- permisos ----------
-- Todos los usuarios leen; el admin solo puede cambiar el nombre. El prefijo
-- lo cambia el alta del cliente (service_role) o el SQL Editor.
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
grant update (business_name) on public.app_settings to authenticated;

create policy "app_settings: authenticated puede leer"
  on public.app_settings for select to authenticated
  using (true);

create policy "app_settings: admin puede actualizar"
  on public.app_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------- helpers de códigos internos ----------
create function public._internal_code_prefix()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select internal_code_prefix from public.app_settings), 'HCH');
$$;

-- Siguiente código interno: <PREFIJO>-000001.
create function public._new_internal_code()
returns text
language sql
volatile
security invoker
set search_path = ''
as $$
  select public._internal_code_prefix() || '-' || lpad(nextval('public.internal_code_seq')::text, 6, '0');
$$;

-- El prefijo interno está reservado para la secuencia.
create function public._check_reserved_barcode(p_barcode text)
returns void
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_prefix text := public._internal_code_prefix();
begin
  if upper(p_barcode) like v_prefix || '-%' then
    raise exception 'El prefijo %- está reservado para códigos internos', v_prefix using errcode = '22023';
  end if;
end;
$$;

revoke all on function public._internal_code_prefix() from public, anon;
revoke all on function public._new_internal_code() from public, anon;
revoke all on function public._check_reserved_barcode(text) from public, anon;
grant execute on function public._internal_code_prefix() to authenticated;
grant execute on function public._new_internal_code() to authenticated;
grant execute on function public._check_reserved_barcode(text) to authenticated;

-- ---------------------------------------------------------------------
-- create_product: igual que en 20261019000100_lotes_ubicaciones.sql, pero
-- con el prefijo configurable.
-- ---------------------------------------------------------------------
create or replace function public.create_product(
  p_barcode            text,
  p_name               text,
  p_price              numeric,
  p_cost               numeric default null,
  p_category           text default null,
  p_supplier           text default null,
  p_initial_quantity   integer default 0,
  p_image_url          text default null,
  p_client_op_id       uuid default null,
  p_description        text default null,
  p_catalog_product_id bigint default null,
  p_location           public.stock_location default 'store',
  p_supplier_id        uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_barcode  text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_internal boolean := false;
  v_loc      public.stock_location := coalesce(p_location, 'store');
  v_product  public.products;
  v_movement public.inventory_movements;
begin
  perform public._require_admin();

  if p_initial_quantity is null or p_initial_quantity < 0 then
    raise exception 'Cantidad inicial inválida: %', p_initial_quantity using errcode = '22023';
  end if;

  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;

  if v_barcode is null then
    v_barcode  := public._new_internal_code();
    v_internal := true;
  else
    select * into v_product from public.products where barcode = v_barcode;
    if found then
      return jsonb_build_object('status', 'exists', 'product', to_jsonb(v_product));
    end if;
    perform public._check_reserved_barcode(v_barcode);
  end if;

  insert into public.products (
    barcode, name, price, cost, category, supplier_id, quantity, image_url, is_internal_code, created_by,
    description, catalog_product_id
  ) values (
    v_barcode,
    btrim(p_name),
    p_price,
    p_cost,
    nullif(btrim(coalesce(p_category, '')), ''),
    public._resolve_supplier(p_supplier_id, p_supplier),
    0,
    p_image_url,
    v_internal,
    auth.uid(),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_catalog_product_id
  )
  returning * into v_product;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by, location)
  values (v_product.id, 'initial_count', p_initial_quantity, p_initial_quantity, 'Alta de producto', p_client_op_id, auth.uid(), v_loc)
  returning * into v_movement;

  if p_initial_quantity > 0 then
    perform public._add_entry(v_product.id, v_loc, p_initial_quantity, null, null, 'product_create', v_movement.id);
  end if;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------------------------------------------------------------------
-- unlink_product: igual que en 20261015000400_correcciones_inventario.sql
-- (SECURITY DEFINER desde 20261019000200_vista_costos.sql), con el prefijo
-- configurable.
-- ---------------------------------------------------------------------
create or replace function public.unlink_product(p_product_id uuid, p_reason text, p_client_op_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product  public.products;
  v_movement public.inventory_movements;
  v_old      text;
  v_new      text;
begin
  if p_client_op_id is not null then
    select * into v_movement from public.inventory_movements where client_op_id = p_client_op_id;
    if found then
      return public._movement_result('duplicate', v_movement);
    end if;
  end if;
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'El motivo es obligatorio' using errcode = '22023';
  end if;

  select * into v_product from public.products where id = p_product_id for update;
  if not found then
    raise exception 'Producto no encontrado' using errcode = 'P0002';
  end if;
  if v_product.is_internal_code and v_product.catalog_product_id is null then
    raise exception 'Este producto no tiene código de barras ni catálogo que desvincular' using errcode = '22023';
  end if;

  v_old := v_product.barcode;
  v_new := v_product.barcode;
  if not v_product.is_internal_code then
    v_new := public._new_internal_code();
  end if;

  update public.products
  set barcode = v_new, is_internal_code = true, catalog_product_id = null
  where id = v_product.id
  returning * into v_product;

  insert into public.inventory_movements (
    product_id, type, delta, quantity_after, note, client_op_id, old_barcode, created_by
  ) values (
    v_product.id,
    'barcode_unlink',
    0,
    v_product.quantity,
    case when v_old = v_new
      then 'Desvinculado del catálogo. Motivo: ' || btrim(p_reason)
      else 'Código ' || v_old || ' desvinculado (ahora ' || v_new || '). Motivo: ' || btrim(p_reason)
    end,
    p_client_op_id,
    case when v_old = v_new then null else v_old end,
    auth.uid()
  )
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;
