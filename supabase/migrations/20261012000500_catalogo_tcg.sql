-- =====================================================================
-- Inventario Hachiko · Catálogo TCG (producto sellado)
-- Copia local del catálogo de TCGplayer (vía tcgcsv.com) para no capturar
-- a mano nombre, foto y descripción. La llena el script
-- `scripts/importar-catalogo.mjs` con la service_role key; la app solo lee.
--
-- Al dar de alta un código, se vincula el producto de inventario con una
-- fila del catálogo (products.catalog_product_id).
-- =====================================================================

-- ---------- catalog_products ----------
create table public.catalog_products (
  -- productId de TCGplayer
  id             bigint primary key,
  category_id    integer not null,
  game           text not null,              -- "Pokemon", "Magic: The Gathering", …
  group_id       integer not null,
  set_name       text,
  set_code       text,
  name           text not null,
  description    text,
  -- URL de la imagen en el CDN de TCGplayer (se copia al bucket al vincular).
  image_url      text,
  -- Solo algunos productos lo traen (sobre todo Magic y Yu-Gi-Oh!).
  upc            text,
  -- Dígitos sin ceros a la izquierda: así un UPC-A (12) y su EAN-13 (0 + 12) coinciden.
  upc_key        text generated always as (
                   nullif(ltrim(regexp_replace(coalesce(upc, ''), '\D', '', 'g'), '0'), '')
                 ) stored,
  market_price   numeric(12, 2),             -- USD, solo referencia
  released_on    date,
  tcgplayer_url  text,
  -- Texto para buscar: minúsculas y sin acentos.
  search_text    text generated always as (
                   translate(lower(name || ' ' || coalesce(set_name, '') || ' ' || coalesce(set_code, '') || ' ' || game),
                             'áéíóúüñ', 'aeiouun')
                 ) stored,
  source_modified_on timestamptz,
  imported_at    timestamptz not null default now()
);

create index catalog_products_upc_idx on public.catalog_products (upc_key) where upc_key is not null;
create index catalog_products_category_idx on public.catalog_products (category_id, released_on desc);

-- ---------- vínculo en products ----------
alter table public.products
  add column description        text,
  add column catalog_product_id bigint references public.catalog_products (id) on delete set null;

create index products_catalog_idx on public.products (catalog_product_id) where catalog_product_id is not null;

-- ---------- permisos ----------
alter table public.catalog_products enable row level security;

revoke all on public.catalog_products from anon, authenticated;
grant select on public.catalog_products to authenticated;
-- El script de importación usa service_role (ignora RLS).
grant all on public.catalog_products to service_role;

create policy "catalog: authenticated puede leer"
  on public.catalog_products for select to authenticated
  using (true);

-- ---------------------------------------------------------------------
-- search_catalog: búsqueda por palabras (todas deben aparecer, en cualquier
-- orden: "delta etb" encuentra "Delta Reign Elite Trainer Box"; "sobre",
-- "caja", "mazo" y "lata" se buscan como pack, box, deck y tin) o por
-- código de barras. Incluye el producto de inventario ya vinculado, si hay.
-- ---------------------------------------------------------------------
create function public.search_catalog(p_query text, p_limit integer default 25)
returns table (
  id              bigint,
  game            text,
  set_name        text,
  set_code        text,
  name            text,
  description     text,
  image_url       text,
  upc             text,
  market_price    numeric,
  released_on     date,
  tcgplayer_url   text,
  upc_match       boolean,
  linked_barcode  text,
  linked_name     text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with q as (
    select
      array_remove(regexp_split_to_array(
        -- Abreviaturas y palabras en español → como aparecen en TCGplayer.
        regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
          translate(lower(btrim(coalesce(p_query, ''))), 'áéíóúüñ', 'aeiouun'),
          '\metb\M', 'elite trainer box', 'g'),
          '\mupc\M', 'ultra premium collection', 'g'),
          '\msobres?\M', 'pack', 'g'),
          '\mcajas?\M', 'box', 'g'),
          '\mmazos?\M', 'deck', 'g'),
          '\mlatas?\M', 'tin', 'g'),
        '\s+'), '') as words,
      nullif(ltrim(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '0'), '') as digits,
      btrim(coalesce(p_query, '')) ~ '^\d{8,14}$' as is_barcode
  )
  select
    c.id, c.game, c.set_name, c.set_code, c.name, c.description, c.image_url, c.upc,
    c.market_price, c.released_on, c.tcgplayer_url,
    (q.is_barcode and c.upc_key = q.digits) as upc_match,
    l.barcode, l.name
  from public.catalog_products c
  cross join q
  left join lateral (
    select p.barcode, p.name
    from public.products p
    where p.catalog_product_id = c.id
    order by p.created_at
    limit 1
  ) l on true
  where cardinality(q.words) > 0
    and (
      (q.is_barcode and c.upc_key = q.digits)
      or not exists (
        select 1 from unnest(q.words) w
        where strpos(c.search_text, w) = 0
      )
    )
  order by (q.is_barcode and c.upc_key = q.digits) desc, c.released_on desc nulls last, c.name
  limit least(greatest(coalesce(p_limit, 25), 1), 100);
$$;

-- Estado del catálogo (para mostrar cuántos productos hay y cuándo se actualizó).
create function public.catalog_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('products', count(*), 'imported_at', max(imported_at))
  from public.catalog_products;
$$;

-- ---------------------------------------------------------------------
-- create_product: igual que antes, más descripción y vínculo al catálogo.
-- Se reemplaza la firma anterior (los parámetros nuevos van al final con
-- default null, así que las llamadas existentes siguen funcionando).
-- ---------------------------------------------------------------------
drop function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid);

create function public.create_product(
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
  p_catalog_product_id bigint default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_barcode  text := nullif(btrim(coalesce(p_barcode, '')), '');
  v_internal boolean := false;
  v_product  public.products;
  v_movement public.inventory_movements;
begin
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
    v_barcode  := 'HCH-' || lpad(nextval('public.internal_code_seq')::text, 6, '0');
    v_internal := true;
  else
    select * into v_product from public.products where barcode = v_barcode;
    if found then
      return jsonb_build_object('status', 'exists', 'product', to_jsonb(v_product));
    end if;
    -- El prefijo HCH- está reservado para la secuencia interna.
    if upper(v_barcode) like 'HCH-%' then
      raise exception 'El prefijo HCH- está reservado para códigos internos' using errcode = '22023';
    end if;
  end if;

  insert into public.products (
    barcode, name, price, cost, category, supplier, quantity, image_url, is_internal_code, created_by,
    description, catalog_product_id
  ) values (
    v_barcode,
    btrim(p_name),
    p_price,
    p_cost,
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_supplier, '')), ''),
    p_initial_quantity,
    p_image_url,
    v_internal,
    auth.uid(),
    nullif(btrim(coalesce(p_description, '')), ''),
    p_catalog_product_id
  )
  returning * into v_product;

  insert into public.inventory_movements (product_id, type, delta, quantity_after, note, client_op_id, created_by)
  values (v_product.id, 'initial_count', p_initial_quantity, p_initial_quantity, 'Alta de producto', p_client_op_id, auth.uid())
  returning * into v_movement;

  return public._movement_result('ok', v_movement);
end;
$$;

-- ---------- Permisos de ejecución ----------
revoke all on function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid, text, bigint) from public, anon;
revoke all on function public.search_catalog(text, integer) from public, anon;
revoke all on function public.catalog_status() from public, anon;

grant execute on function public.create_product(text, text, numeric, numeric, text, text, integer, text, uuid, text, bigint) to authenticated;
grant execute on function public.search_catalog(text, integer) to authenticated;
grant execute on function public.catalog_status() to authenticated;
