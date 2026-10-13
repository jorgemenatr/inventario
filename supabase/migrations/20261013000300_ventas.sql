-- =====================================================================
-- Inventario Hachiko · Mostrador y ventas
-- Los tickets ABIERTOS viven en la computadora del mostrador (hay un solo
-- POS). Al presionar "Pagar" se registra aquí la venta completa con
-- pay_ticket(): ticket + productos + descuento de inventario + movimientos
-- 'sale', todo en una transacción. Sin red, la venta se encola y se envía
-- después con el mismo id (idempotente: no se cobra dos veces).
-- =====================================================================

create type public.payment_method as enum ('cash', 'card', 'credit', 'transfer');

-- ---------- tickets (ventas cobradas) ----------
create table public.tickets (
  -- Lo genera el mostrador al abrir el ticket: sirve de llave de idempotencia.
  id              uuid primary key,
  name            text not null check (length(btrim(name)) > 0),
  status          text not null default 'paid' check (status in ('open', 'paid')),
  customer_id     uuid references public.customers (id) on delete restrict,
  payment_method  public.payment_method not null,
  item_count      integer not null check (item_count > 0),
  subtotal        numeric(12, 2) not null check (subtotal >= 0),
  total           numeric(12, 2) not null check (total >= 0),
  -- Llegó desde la cola sin conexión (se cobró sin red).
  paid_offline    boolean not null default false,
  note            text,
  opened_at       timestamptz,
  paid_at         timestamptz not null default now(),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now()
);

create index tickets_paid_idx on public.tickets (paid_at desc);
create index tickets_customer_idx on public.tickets (customer_id, paid_at desc) where customer_id is not null;

-- ---------- ticket_items ----------
create table public.ticket_items (
  id            uuid primary key default gen_random_uuid(),
  ticket_id     uuid not null references public.tickets (id) on delete cascade,
  product_id    uuid not null references public.products (id) on delete restrict,
  -- Copia del producto al momento de la venta (el historial no cambia si luego se edita).
  barcode       text not null,
  product_name  text not null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(12, 2) not null check (unit_price >= 0),
  line_total    numeric(12, 2) generated always as (quantity * unit_price) stored,
  position      integer not null default 0
);

create index ticket_items_ticket_idx on public.ticket_items (ticket_id, position);
create index ticket_items_product_idx on public.ticket_items (product_id);

-- Movimientos de inventario ligados a la venta que los generó.
alter table public.inventory_movements
  add column ticket_id uuid references public.tickets (id) on delete restrict;

create index inventory_movements_ticket_idx on public.inventory_movements (ticket_id) where ticket_id is not null;

-- ---------- permisos ----------
alter table public.tickets      enable row level security;
alter table public.ticket_items enable row level security;

revoke all on public.tickets, public.ticket_items from anon, authenticated;
-- Ventas inmutables desde la app (sin cancelaciones por ahora): solo se insertan vía pay_ticket.
grant select, insert on public.tickets      to authenticated;
grant select, insert on public.ticket_items to authenticated;

create policy "tickets: authenticated puede leer"
  on public.tickets for select to authenticated using (true);
create policy "tickets: authenticated registra como sí mismo"
  on public.tickets for insert to authenticated with check (created_by = auth.uid());

create policy "ticket_items: authenticated puede leer"
  on public.ticket_items for select to authenticated using (true);
create policy "ticket_items: authenticated puede insertar"
  on public.ticket_items for insert to authenticated with check (true);

-- ---------------------------------------------------------------------
-- pay_ticket: cobra un ticket.
--   p_items: [{ "barcode": "...", "quantity": 2, "unit_price": 1899.00 }, ...]
--   p_offline: true cuando viene de la cola sin conexión. En ese caso el
--     dinero ya se cobró, así que no se rechaza por stock: se registra y se
--     anota en la nota del ticket.
-- status: 'ok' | 'duplicate' (ese ticket ya estaba cobrado)
-- Errores: producto inexistente, stock insuficiente (en línea), datos inválidos.
-- ---------------------------------------------------------------------
create function public.pay_ticket(
  p_ticket_id      uuid,
  p_name           text,
  p_payment_method public.payment_method,
  p_items          jsonb,
  p_customer_id    uuid default null,
  p_opened_at      timestamptz default null,
  p_offline        boolean default false
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ticket   public.tickets;
  v_items    jsonb;
  v_item     record;
  v_product  public.products;
  v_missing  text;
  v_short    text[] := '{}';
  v_count    integer;
  v_total    numeric(12, 2);
  v_products jsonb := '[]'::jsonb;
begin
  -- Idempotencia: si ya se cobró (reintento de la cola), se devuelve tal cual.
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'ticket', to_jsonb(v_ticket), 'products', '[]'::jsonb);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no tiene productos' using errcode = '22023';
  end if;
  if p_name is null or btrim(p_name) = '' then
    raise exception 'El ticket necesita un nombre' using errcode = '22023';
  end if;

  -- Renglones agrupados por código (por si el mismo producto viene dos veces).
  select jsonb_agg(jsonb_build_object('barcode', barcode, 'quantity', quantity, 'unit_price', unit_price, 'position', position)
                   order by position)
  into v_items
  from (
    select
      btrim(e ->> 'barcode')             as barcode,
      sum((e ->> 'quantity')::integer)   as quantity,
      max((e ->> 'unit_price')::numeric) as unit_price,
      min(ord)                           as position
    from jsonb_array_elements(p_items) with ordinality as t(e, ord)
    group by btrim(e ->> 'barcode')
  ) g;

  if exists (
    select 1 from jsonb_to_recordset(v_items) as i(barcode text, quantity integer, unit_price numeric)
    where coalesce(i.barcode, '') = '' or i.quantity is null or i.quantity <= 0 or i.unit_price is null or i.unit_price < 0
  ) then
    raise exception 'Hay productos con datos inválidos en el ticket' using errcode = '22023';
  end if;

  select string_agg(i.barcode, ', ') into v_missing
  from jsonb_to_recordset(v_items) as i(barcode text)
  where not exists (select 1 from public.products p where p.barcode = i.barcode);
  if v_missing is not null then
    raise exception 'No existe el producto %', v_missing using errcode = 'P0002';
  end if;

  -- Bloquea los productos en orden fijo (evita interbloqueos) y revisa stock.
  for v_item in
    select p.name, p.quantity as stock, i.quantity
    from jsonb_to_recordset(v_items) as i(barcode text, quantity integer)
    join public.products p on p.barcode = i.barcode
    order by p.id
    for update of p
  loop
    if v_item.quantity > v_item.stock then
      v_short := v_short || format('%s (pide %s, hay %s)', v_item.name, v_item.quantity, v_item.stock);
    end if;
  end loop;

  if cardinality(v_short) > 0 and not coalesce(p_offline, false) then
    raise exception 'Stock insuficiente: %', array_to_string(v_short, '; ') using errcode = 'P0001';
  end if;

  select sum(i.quantity), sum(i.quantity * i.unit_price) into v_count, v_total
  from jsonb_to_recordset(v_items) as i(quantity integer, unit_price numeric);

  insert into public.tickets (
    id, name, customer_id, payment_method, item_count, subtotal, total, paid_offline, note, opened_at, created_by
  ) values (
    p_ticket_id,
    btrim(p_name),
    p_customer_id,
    p_payment_method,
    v_count,
    v_total,
    v_total,
    coalesce(p_offline, false),
    case when cardinality(v_short) > 0
      then 'Cobrado sin conexión con stock insuficiente al sincronizar: ' || array_to_string(v_short, '; ')
    end,
    p_opened_at,
    auth.uid()
  )
  returning * into v_ticket;

  for v_item in
    select i.barcode, i.quantity, i.unit_price, i.position, p.id as product_id, p.name as product_name
    from jsonb_to_recordset(v_items) as i(barcode text, quantity integer, unit_price numeric, position integer)
    join public.products p on p.barcode = i.barcode
    order by i.position
  loop
    insert into public.ticket_items (ticket_id, product_id, barcode, product_name, quantity, unit_price, position)
    values (v_ticket.id, v_item.product_id, v_item.barcode, v_item.product_name, v_item.quantity, v_item.unit_price, v_item.position);

    update public.products set quantity = quantity - v_item.quantity
    where id = v_item.product_id
    returning * into v_product;

    insert into public.inventory_movements (product_id, type, delta, quantity_after, note, ticket_id, created_by)
    values (v_product.id, 'sale', -v_item.quantity, v_product.quantity, 'Venta: ' || v_ticket.name, v_ticket.id, auth.uid());

    v_products := v_products || to_jsonb(v_product);
  end loop;

  return jsonb_build_object('status', 'ok', 'ticket', to_jsonb(v_ticket), 'products', v_products);
end;
$$;

-- ---------------------------------------------------------------------
-- Historial de ventas con cliente y quién cobró (respeta RLS).
-- ---------------------------------------------------------------------
create view public.sales_history
with (security_invoker = true)
as
select
  t.id,
  t.name,
  t.status,
  t.payment_method,
  t.item_count,
  t.subtotal,
  t.total,
  t.paid_offline,
  t.note,
  t.opened_at,
  t.paid_at,
  t.customer_id,
  c.name       as customer_name,
  t.created_by,
  pr.email     as created_by_email,
  pr.full_name as created_by_name
from public.tickets t
left join public.customers c on c.id = t.customer_id
left join public.profiles pr on pr.id = t.created_by;

revoke all on public.sales_history from anon, authenticated;
grant select on public.sales_history to authenticated;

-- ---------- Permisos de ejecución ----------
revoke all on function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean) from public, anon;
grant execute on function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean) to authenticated;
