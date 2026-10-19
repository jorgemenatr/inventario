-- =====================================================================
-- Categorías de producto configurables (cada cliente define las suyas)
--
-- Antes la lista era fija en la app (src/lib/categories.ts). Ahora vive en
-- product_categories: categorías principales y, opcionalmente, un nivel de
-- subcategorías ("TCG" → "Pokémon", "Magic", …).
--
-- products.category sigue siendo texto ("TCG · Pokémon" o "Cafetería") para
-- no romper la cola sin conexión ni los productos existentes. Al renombrar
-- una categoría se actualizan sus productos; no se puede borrar una que
-- tenga productos o subcategorías.
--
-- Catálogo TCG por cliente: cada categoría puede ligar fuentes del catálogo
-- de TCGplayer (catalog_sources: 'pokemon', 'magic', 'dragon-shield', …,
-- ver src/lib/catalogSources.json). El importador solo baja esas fuentes y
-- la búsqueda del alta solo muestra esas. Al ligar un producto del catálogo,
-- la categoría sugerida es la que tiene su fuente.
--
-- Aplicar ANTES de publicar la app que la usa: la app anterior sigue
-- funcionando con esta base (search_catalog solo gana una columna).
-- =====================================================================

create table public.product_categories (
  id              uuid primary key default gen_random_uuid(),
  parent_id       uuid references public.product_categories (id) on delete restrict,
  name            text not null check (
                    length(btrim(name)) between 1 and 60
                    and name = btrim(name)
                    and position(' · ' in name) = 0
                  ),
  catalog_sources text[] not null default '{}',
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Nombre único entre hermanas (sin importar mayúsculas).
create unique index product_categories_name_key
  on public.product_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));
create index product_categories_parent_idx on public.product_categories (parent_id);

create trigger product_categories_set_updated_at
  before update on public.product_categories
  for each row execute function public.set_updated_at();

-- Texto que se guarda en products.category.
create function public.category_value(p_category public.product_categories)
returns text
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce((select pc.name || ' · ' from public.product_categories pc where pc.id = p_category.parent_id), '')
         || p_category.name;
$$;

-- ---------- reglas ----------
create function public.guard_product_categories()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_dup text;
begin
  -- Solo un nivel de subcategorías.
  if new.parent_id is not null then
    if new.parent_id = new.id
       or exists (select 1 from public.product_categories where id = new.parent_id and parent_id is not null) then
      raise exception 'Solo se permite un nivel de subcategorías' using errcode = '22023';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from public.product_categories where parent_id = new.id) then
      raise exception 'Una categoría con subcategorías no puede volverse subcategoría' using errcode = '22023';
    end if;
  end if;

  -- Cada fuente del catálogo sugiere una sola categoría.
  new.catalog_sources := array(select distinct s from unnest(new.catalog_sources) s where btrim(s) <> '' order by s);
  select public.category_value(pc) into v_dup
  from public.product_categories pc
  where pc.id <> new.id and pc.catalog_sources && new.catalog_sources
  limit 1;
  if v_dup is not null then
    raise exception 'Ese juego del catálogo ya está ligado a la categoría "%"', v_dup using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger product_categories_guard
  before insert or update on public.product_categories
  for each row execute function public.guard_product_categories();

-- Renombrar o mover: los productos se van con su categoría.
create function public.sync_category_products()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old text;
  v_new text;
begin
  v_old := coalesce((select name || ' · ' from public.product_categories where id = old.parent_id), '') || old.name;
  v_new := public.category_value(new);
  if v_old = v_new then
    return null;
  end if;
  update public.products set category = v_new where category = v_old;
  -- Las subcategorías llevan el nombre de la principal.
  update public.products
  set category = v_new || substr(category, length(v_old) + 1)
  where left(category, length(v_old) + 3) = v_old || ' · '
    and new.parent_id is null;
  return null;
end;
$$;

create trigger product_categories_sync_products
  after update of name, parent_id on public.product_categories
  for each row execute function public.sync_category_products();

-- No se borra una categoría que tiene productos o subcategorías.
create function public.guard_category_delete()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_value text := coalesce((select name || ' · ' from public.product_categories where id = old.parent_id), '') || old.name;
  v_count integer;
begin
  if exists (select 1 from public.product_categories where parent_id = old.id) then
    raise exception 'La categoría "%" tiene subcategorías. Bórralas o muévelas antes.', v_value using errcode = '23503';
  end if;
  select count(*) into v_count from public.products where category = v_value;
  if v_count > 0 then
    raise exception 'La categoría "%" tiene % producto(s). Cámbialos de categoría antes de borrarla.', v_value, v_count
      using errcode = '23503';
  end if;
  return old;
end;
$$;

create trigger product_categories_guard_delete
  before delete on public.product_categories
  for each row execute function public.guard_category_delete();

revoke all on function public.guard_product_categories() from public, anon, authenticated;
revoke all on function public.sync_category_products() from public, anon, authenticated;
revoke all on function public.guard_category_delete() from public, anon, authenticated;
revoke all on function public.category_value(public.product_categories) from public, anon;
grant execute on function public.category_value(public.product_categories) to authenticated;

-- ---------- permisos ----------
alter table public.product_categories enable row level security;
revoke all on public.product_categories from anon, authenticated;
grant select, insert, update, delete on public.product_categories to authenticated;

create policy "categories: authenticated puede leer"
  on public.product_categories for select to authenticated
  using (true);

create policy "categories: admin puede crear"
  on public.product_categories for insert to authenticated
  with check (public.is_admin());

create policy "categories: admin puede actualizar"
  on public.product_categories for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "categories: admin puede borrar"
  on public.product_categories for delete to authenticated
  using (public.is_admin());

-- ---------- catálogo: de qué fuente viene cada producto ----------
alter table public.catalog_products add column source text;
create index catalog_products_source_idx on public.catalog_products (source);

-- Lo que ya estaba importado (antes no se guardaba la fuente).
update public.catalog_products set source = case
  when game = 'Dragon Shield' then 'dragon-shield'
  when game = 'Ultra Pro' then 'ultra-pro-pokemon'
  else case category_id
    when 3  then 'pokemon'
    when 85 then 'pokemon-japan'
    when 1  then 'magic'
    when 2  then 'yugioh'
    when 71 then 'lorcana'
    when 62 then 'flesh-and-blood'
    when 68 then 'one-piece'
    when 63 then 'digimon'
    when 80 then 'dragon-ball-fusion-world'
    when 27 then 'dragon-ball-masters'
    when 79 then 'star-wars-unlimited'
    when 86 then 'gundam'
    when 89 then 'riftbound'
    when 81 then 'union-arena'
    when 20 then 'weiss-schwarz'
    when 16 then 'vanguard'
    when 74 then 'grand-archive'
    when 77 then 'sorcery'
    when 24 then 'final-fantasy'
    when 73 then 'shadowverse'
    when 72 then 'battle-spirits'
    when 66 then 'metazoo'
  end
end
where source is null;

-- Fuentes que el negocio vende (las de sus categorías).
create function public.enabled_catalog_sources()
returns text[]
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(array_agg(distinct s order by s), '{}')
  from public.product_categories, unnest(catalog_sources) s;
$$;

revoke all on function public.enabled_catalog_sources() from public, anon;
grant execute on function public.enabled_catalog_sources() to authenticated, service_role;

-- search_catalog: igual que en 20261013000100_catalogo_busqueda_accesorios.sql,
-- más la columna source y solo las fuentes que el negocio vende.
drop function public.search_catalog(text, integer);

create function public.search_catalog(p_query text, p_limit integer default 25)
returns table (
  id              bigint,
  game            text,
  source          text,
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
  with syn(pattern, repl) as (
    values
      -- Producto sellado
      ('^etb$',                  'elite trainer box'),
      ('^upc$',                  'ultra premium collection'),
      ('^sobres?$',              'pack'),
      ('^cajas?$',               'box'),
      ('^mazos?$',               'deck'),
      ('^latas?$',               'tin'),
      -- Accesorios (como los nombra TCGplayer: "Card Sleeves", "Storage Albums", …)
      ('^(micas?|fundas?|protectores?)$', 'sleeves'),
      ('^(carpetas?|albums?|albumes)$',   'albums'),
      ('^(tapetes?|playmats?)$',          'playmat'),
      ('^portafolios?$',                  'portfolio'),
      ('^paginas?$',                      'pages'),
      ('^bolsillos?$',                    'pocket'),
      ('^mate$',                          'matte'),
      -- Colores
      ('^negr[oa]s?$',           'black'),
      ('^blanc[oa]s?$',          'white'),
      ('^roj[oa]s?$',            'red'),
      ('^azul(es)?$',            'blue'),
      ('^verdes?$',              'green'),
      ('^amarill[oa]s?$',        'yellow'),
      ('^morad[oa]s?$',          'purple'),
      ('^rosas?$',               'pink'),
      ('^naranjas?$',            'orange'),
      ('^dorad[oa]s?$',          'gold'),
      ('^platead[oa]s?$',        'silver'),
      ('^transparentes?$',       'clear')
  ),
  raw as (
    select translate(lower(btrim(coalesce(p_query, ''))), 'áéíóúüñ', 'aeiouun') as text
  ),
  q as (
    select
      array(
        select part
        from unnest(regexp_split_to_array(raw.text, '\s+')) with ordinality as w(word, n)
        cross join lateral (
          select coalesce((select s.repl from syn s where w.word ~ s.pattern limit 1), w.word) as term
        ) t
        cross join lateral unnest(string_to_array(t.term, ' ')) as part
        where part <> ''
        order by w.n
      ) as words,
      nullif(ltrim(regexp_replace(coalesce(p_query, ''), '\D', '', 'g'), '0'), '') as digits,
      btrim(coalesce(p_query, '')) ~ '^\d{8,14}$' as is_barcode,
      public.enabled_catalog_sources() as sources
    from raw
  )
  select
    c.id, c.game, c.source, c.set_name, c.set_code, c.name, c.description, c.image_url, c.upc,
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
    and c.source = any (q.sources)
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

revoke all on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;

-- catalog_status: solo cuenta lo que el negocio vende.
create or replace function public.catalog_status()
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object('products', count(*), 'imported_at', max(imported_at))
  from public.catalog_products
  where source = any (public.enabled_catalog_sources());
$$;

-- ---------- categorías de las bases que ya estaban en uso ----------
-- Hachiko: la lista que antes era fija, con sus juegos ligados al catálogo.
-- Una base nueva empieza vacía (el alta del cliente o el admin las crean).
do $$
declare
  v_tcg uuid;
  v_value text;
  v_parent uuid;
  v_n integer := 100;
begin
  if not exists (select 1 from public.products) then
    return;
  end if;

  insert into public.product_categories (name, sort_order) values ('TCG', 1) returning id into v_tcg;
  insert into public.product_categories (parent_id, name, catalog_sources, sort_order) values
    (v_tcg, 'Pokémon',         '{pokemon}',         1),
    (v_tcg, 'Yu-Gi-Oh!',       '{yugioh}',          2),
    (v_tcg, 'Lorcana',         '{lorcana}',         3),
    (v_tcg, 'Magic',           '{magic}',           4),
    (v_tcg, 'Flesh and Blood', '{flesh-and-blood}', 5);
  insert into public.product_categories (name, catalog_sources, sort_order) values
    ('Accesorios',     '{dragon-shield,ultra-pro-pokemon}', 2),
    ('Cafetería',      '{}', 3),
    ('Comida',         '{}', 4),
    ('Juegos de Mesa', '{}', 5),
    ('Torneos',        '{}', 6);

  -- Categorías libres de productos viejos: se agregan para no perderlas.
  for v_value in
    select distinct category from public.products
    where category is not null and btrim(category) <> ''
    order by 1
  loop
    begin
      if position(' · ' in v_value) > 0 then
        select id into v_parent from public.product_categories
        where parent_id is null and lower(name) = lower(split_part(v_value, ' · ', 1));
        if v_parent is null then
          insert into public.product_categories (name, sort_order)
          values (split_part(v_value, ' · ', 1), v_n) returning id into v_parent;
          v_n := v_n + 1;
        end if;
        insert into public.product_categories (parent_id, name, sort_order)
        values (v_parent, substr(v_value, length(split_part(v_value, ' · ', 1)) + 4), v_n)
        on conflict do nothing;
      else
        insert into public.product_categories (name, sort_order) values (v_value, v_n) on conflict do nothing;
      end if;
    exception when check_violation then
      -- Un nombre raro (muy largo, tres niveles…) se queda como texto libre en el producto.
      raise notice 'La categoría vieja "%" no se pudo agregar: %', v_value, sqlerrm;
    end;
    v_n := v_n + 1;
  end loop;
end $$;
