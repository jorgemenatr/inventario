-- =====================================================================
-- Inventario Hachiko · Créditos de tienda y pagos con varios métodos
--
-- Créditos: cada cliente tiene un historial de movimientos (ganados con
-- grant_credits, usados al pagar con pay_ticket). El saldo es la suma.
-- 1 crédito = $1.
--
-- Pagos: un ticket se puede pagar con varios métodos (ticket_payments). Si
-- hay más de uno, tickets.payment_method = 'mixed'.
-- =====================================================================

-- 'mixed' se usa solo dentro de funciones (en tiempo de ejecución), así que se
-- puede agregar en la misma transacción.
alter type public.payment_method add value if not exists 'mixed';

-- ---------- pagos de cada ticket ----------
create table public.ticket_payments (
  id         uuid primary key default gen_random_uuid(),
  ticket_id  uuid not null references public.tickets (id) on delete cascade,
  method     public.payment_method not null,
  amount     numeric(12, 2) not null check (amount > 0)
);

create index ticket_payments_ticket_idx on public.ticket_payments (ticket_id);

-- Ventas ya registradas: un pago por el total con su método.
insert into public.ticket_payments (ticket_id, method, amount)
select id, payment_method, total from public.tickets where total > 0;

-- ---------- movimientos de crédito ----------
create table public.customer_credit_movements (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers (id) on delete restrict,
  -- grant: crédito ganado (premio, devolución…); sale: crédito usado en una compra.
  kind        text not null check (kind in ('grant', 'sale')),
  amount      numeric(12, 2) not null,
  note        text,
  ticket_id   uuid references public.tickets (id) on delete restrict,
  -- Mismo id para los créditos dados juntos ("Agregar créditos" a varios clientes).
  batch_id    uuid,
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (
    (kind = 'grant' and amount > 0 and length(btrim(coalesce(note, ''))) > 0)
    or (kind = 'sale' and amount < 0 and ticket_id is not null)
  )
);

create index credit_movements_customer_idx on public.customer_credit_movements (customer_id, created_at desc);
create index credit_movements_batch_idx on public.customer_credit_movements (batch_id) where batch_id is not null;

-- ---------- permisos ----------
alter table public.ticket_payments           enable row level security;
alter table public.customer_credit_movements enable row level security;

revoke all on public.ticket_payments, public.customer_credit_movements from anon, authenticated;
-- Solo lectura e inserción (vía pay_ticket / grant_credits); nada se edita ni se borra.
grant select, insert on public.ticket_payments           to authenticated;
grant select, insert on public.customer_credit_movements to authenticated;

create policy "ticket_payments: authenticated puede leer"
  on public.ticket_payments for select to authenticated using (true);
create policy "ticket_payments: authenticated puede insertar"
  on public.ticket_payments for insert to authenticated with check (true);

create policy "credit_movements: authenticated puede leer"
  on public.customer_credit_movements for select to authenticated using (true);
create policy "credit_movements: authenticated registra como sí mismo"
  on public.customer_credit_movements for insert to authenticated with check (created_by = auth.uid());

-- ---------- vistas ----------
-- Saldo de cada cliente: ganado, usado y disponible.
create view public.customer_credit_balances
with (security_invoker = true)
as
select
  c.id                                                         as customer_id,
  coalesce(sum(m.amount) filter (where m.amount > 0), 0)       as earned,
  coalesce(-sum(m.amount) filter (where m.amount < 0), 0)      as used,
  coalesce(sum(m.amount), 0)                                   as balance
from public.customers c
left join public.customer_credit_movements m on m.customer_id = c.id
group by c.id;

-- Historial de créditos con quién lo registró y el ticket donde se usó.
create view public.credit_movement_history
with (security_invoker = true)
as
select
  m.id,
  m.customer_id,
  m.kind,
  m.amount,
  m.note,
  m.ticket_id,
  t.name       as ticket_name,
  m.batch_id,
  m.created_at,
  m.created_by,
  pr.email     as created_by_email,
  pr.full_name as created_by_name
from public.customer_credit_movements m
left join public.tickets t on t.id = m.ticket_id
left join public.profiles pr on pr.id = m.created_by;

-- Pagos con datos del ticket (para sumar por método con los filtros de Ventas).
create view public.sales_payments
with (security_invoker = true)
as
select
  p.ticket_id,
  p.method,
  p.amount,
  t.paid_at,
  t.customer_id,
  t.payment_method
from public.ticket_payments p
join public.tickets t on t.id = p.ticket_id;

revoke all on public.customer_credit_balances, public.credit_movement_history, public.sales_payments from anon, authenticated;
grant select on public.customer_credit_balances, public.credit_movement_history, public.sales_payments to authenticated;

-- ---------------------------------------------------------------------
-- grant_credits: da créditos a uno o varios clientes con el mismo concepto.
--   p_grants: [{ "customer_id": "...", "amount": 150 }, ...]
--   p_batch_id lo genera la app: si se reintenta, no se duplica.
-- status: 'ok' | 'duplicate'
-- ---------------------------------------------------------------------
create function public.grant_credits(p_batch_id uuid, p_note text, p_grants jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
  v_total numeric(12, 2);
begin
  select count(*), coalesce(sum(amount), 0) into v_count, v_total
  from public.customer_credit_movements where batch_id = p_batch_id;
  if v_count > 0 then
    return jsonb_build_object('status', 'duplicate', 'count', v_count, 'total', v_total);
  end if;

  if p_note is null or btrim(p_note) = '' then
    raise exception 'El concepto es obligatorio' using errcode = '22023';
  end if;
  if p_grants is null or jsonb_typeof(p_grants) <> 'array' or jsonb_array_length(p_grants) = 0 then
    raise exception 'No hay créditos que agregar' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_grants) as g(customer_id uuid, amount numeric)
    where g.customer_id is null or g.amount is null or g.amount <= 0 or g.amount <> round(g.amount, 2)
  ) then
    raise exception 'Hay montos inválidos (deben ser mayores a 0, con máximo 2 decimales)' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_to_recordset(p_grants) as g(customer_id uuid)
    where not exists (select 1 from public.customers c where c.id = g.customer_id)
  ) then
    raise exception 'Uno de los clientes no existe' using errcode = 'P0002';
  end if;

  insert into public.customer_credit_movements (customer_id, kind, amount, note, batch_id, created_by)
  select g.customer_id, 'grant', g.amount, btrim(p_note), p_batch_id, auth.uid()
  from jsonb_to_recordset(p_grants) as g(customer_id uuid, amount numeric);

  get diagnostics v_count = row_count;
  select coalesce(sum(amount), 0) into v_total from public.customer_credit_movements where batch_id = p_batch_id;
  return jsonb_build_object('status', 'ok', 'count', v_count, 'total', v_total);
end;
$$;

-- ---------------------------------------------------------------------
-- pay_ticket: igual que antes, más pagos con varios métodos y créditos.
-- Se reemplaza la firma anterior (p_payments va al final con default null,
-- así que las llamadas existentes, incluida la cola sin conexión, siguen
-- funcionando).
-- ---------------------------------------------------------------------
drop function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean);

create function public.pay_ticket(
  p_ticket_id      uuid,
  p_name           text,
  p_payment_method public.payment_method,
  p_items          jsonb,
  p_customer_id    uuid default null,
  p_opened_at      timestamptz default null,
  p_offline        boolean default false,
  -- [{ "method": "cash", "amount": 500 }, { "method": "credit", "amount": 200 }]
  -- null = un solo pago por el total con p_payment_method (clientes anteriores y cola vieja).
  p_payments       jsonb default null
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
  v_payments jsonb;
  v_paid     numeric(12, 2);
  v_credit   numeric(12, 2);
  v_balance  numeric(12, 2);
  v_methods  integer;
  v_method   public.payment_method;
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

  -- ---------- pagos ----------
  if p_payments is null then
    if p_payment_method is null or p_payment_method = 'mixed' then
      raise exception 'Falta la forma de pago' using errcode = '22023';
    end if;
    v_payments := case when v_total > 0
      then jsonb_build_array(jsonb_build_object('method', p_payment_method, 'amount', v_total))
      else '[]'::jsonb end;
  else
    if jsonb_typeof(p_payments) <> 'array' then
      raise exception 'Pagos inválidos' using errcode = '22023';
    end if;
    -- Agrupa por método (si el mismo método viene dos veces, se suma).
    select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amount)), '[]'::jsonb)
    into v_payments
    from (
      select e ->> 'method' as method, sum((e ->> 'amount')::numeric(12, 2)) as amount
      from jsonb_array_elements(p_payments) e
      group by e ->> 'method'
    ) g;
    if exists (
      select 1 from jsonb_to_recordset(v_payments) as x(method text, amount numeric)
      where x.method is null or x.method not in ('cash', 'card', 'credit', 'transfer') or x.amount is null or x.amount <= 0
    ) then
      raise exception 'Hay pagos con método o monto inválido' using errcode = '22023';
    end if;
  end if;

  select coalesce(sum(x.amount), 0), coalesce(sum(x.amount) filter (where x.method = 'credit'), 0), count(*)
  into v_paid, v_credit, v_methods
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if v_paid <> v_total then
    raise exception 'Los pagos (%) no suman el total del ticket (%)', v_paid, v_total using errcode = '22023';
  end if;

  v_method := case
    when v_methods > 1 then 'mixed'::public.payment_method
    when v_methods = 1 then (v_payments -> 0 ->> 'method')::public.payment_method
    else coalesce(p_payment_method, 'cash')
  end;

  -- Créditos: el cliente debe tener saldo. Se bloquea al cliente para que dos
  -- cobros al mismo tiempo no usen el mismo saldo.
  if v_credit > 0 then
    if p_customer_id is null then
      raise exception 'Para pagar con créditos el ticket necesita un cliente' using errcode = '22023';
    end if;
    perform 1 from public.customers where id = p_customer_id for update;
    if not found then
      raise exception 'No existe el cliente' using errcode = 'P0002';
    end if;
    select coalesce(sum(amount), 0) into v_balance
    from public.customer_credit_movements where customer_id = p_customer_id;
    if v_credit > v_balance then
      raise exception 'Créditos insuficientes: el cliente tiene % y se quieren usar %', v_balance, v_credit using errcode = 'P0001';
    end if;
  end if;

  insert into public.tickets (
    id, name, customer_id, payment_method, item_count, subtotal, total, paid_offline, note, opened_at, created_by
  ) values (
    p_ticket_id,
    btrim(p_name),
    p_customer_id,
    v_method,
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

  insert into public.ticket_payments (ticket_id, method, amount)
  select v_ticket.id, x.method::public.payment_method, x.amount
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if v_credit > 0 then
    insert into public.customer_credit_movements (customer_id, kind, amount, note, ticket_id, created_by)
    values (p_customer_id, 'sale', -v_credit, 'Compra: ' || v_ticket.name, v_ticket.id, auth.uid());
  end if;

  return jsonb_build_object('status', 'ok', 'ticket', to_jsonb(v_ticket), 'products', v_products, 'payments', v_payments);
end;
$$;

-- ---------- Permisos de ejecución ----------
revoke all on function public.grant_credits(uuid, text, jsonb) from public, anon;
revoke all on function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb) from public, anon;
grant execute on function public.grant_credits(uuid, text, jsonb) to authenticated;
grant execute on function public.pay_ticket(uuid, text, public.payment_method, jsonb, uuid, timestamptz, boolean, jsonb) to authenticated;
