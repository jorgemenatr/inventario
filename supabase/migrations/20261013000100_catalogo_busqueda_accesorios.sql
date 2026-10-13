-- =====================================================================
-- Inventario Hachiko · Catálogo TCG · Búsqueda en español para accesorios
-- El catálogo ya trae accesorios (Dragon Shield y Ultra Pro de Pokémon).
-- Se reemplaza search_catalog (misma firma) para que entienda palabras en
-- español como aparecen en la tienda: "micas negras mate" → sleeves black
-- matte, "tapete pikachu" → playmat pikachu, "carpeta 9 bolsillos" → …
-- Cada palabra se traduce por separado (singular/plural y masculino/femenino).
-- =====================================================================

create or replace function public.search_catalog(p_query text, p_limit integer default 25)
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
      btrim(coalesce(p_query, '')) ~ '^\d{8,14}$' as is_barcode
    from raw
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

-- create or replace conserva los permisos; se repiten por claridad.
revoke all on function public.search_catalog(text, integer) from public, anon;
grant execute on function public.search_catalog(text, integer) to authenticated;
