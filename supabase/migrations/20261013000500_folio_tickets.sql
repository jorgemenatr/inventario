-- =====================================================================
-- Inventario Hachiko · Folio de tickets
-- Los tickets abiertos ya no llevan nombre. Al cobrar, cada venta recibe un
-- folio consecutivo que nunca se repite ("Ticket 1", "Ticket 2", …). El
-- contador vive en una fila que se actualiza dentro de la transacción del
-- cobro: si el cobro falla, el número no se consume (no hay huecos).
-- Las ventas cobradas sin conexión reciben su folio al sincronizarse.
-- =====================================================================

-- ---------- folio en tickets ----------
alter table public.tickets add column number bigint;

-- Ventas existentes: se numeran por fecha de cobro.
with n as (
  select id, row_number() over (order by paid_at, created_at, id) as rn
  from public.tickets
)
update public.tickets t
set number = n.rn, name = 'Ticket ' || n.rn
from n
where n.id = t.id;

alter table public.tickets alter column number set not null;
alter table public.tickets add constraint tickets_number_key unique (number);

-- ---------- contador ----------
create table public.ticket_counter (
  id          boolean primary key default true check (id),  -- una sola fila
  last_number bigint not null
);

insert into public.ticket_counter (id, last_number)
values (true, coalesce((select max(number) from public.tickets), 0));

-- Nadie lo toca directo: solo la función de abajo.
alter table public.ticket_counter enable row level security;
revoke all on public.ticket_counter from anon, authenticated;

-- SECURITY DEFINER para poder actualizar el contador sin dar permisos sobre la
-- tabla. Corre dentro de la transacción de pay_ticket (bloquea la fila hasta
-- terminar el cobro, así dos cobros no reciben el mismo número).
create function public._next_ticket_number()
returns bigint
language sql
security definer
set search_path = ''
as $$
  update public.ticket_counter set last_number = last_number + 1 returning last_number;
$$;

revoke all on function public._next_ticket_number() from public, anon;
grant execute on function public._next_ticket_number() to authenticated;

-- ---------- historial de ventas con folio ----------
create or replace view public.sales_history
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
  pr.full_name as created_by_name,
  t.number
from public.tickets t
left join public.customers c on c.id = t.customer_id
left join public.profiles pr on pr.id = t.created_by;

-- ---------------------------------------------------------------------
-- pay_ticket: igual que antes, pero el nombre lo pone el servidor con el
-- folio ("Ticket N"). Misma firma: las llamadas existentes siguen igual.
-- ---------------------------------------------------------------------
create or replace function public.pay_ticket(
  p_ticket_id      uuid,
  -- Ya no se usa: el nombre es "Ticket N" con el folio que se asigna aquí.
  -- Se conserva para no romper llamadas existentes (y la cola sin conexión).
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
  v_number   bigint;
begin
  -- Idempotencia: si ya se cobró (reintento de la cola), se devuelve tal cual.
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'ticket', to_jsonb(v_ticket), 'products', '[]'::jsonb);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no tiene productos' using errcode = '22023';
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

  -- Folio consecutivo sin huecos: si algo falla más abajo, la transacción
  -- completa se deshace y el número no se pierde.
  v_number := public._next_ticket_number();

  insert into public.tickets (
    id, number, name, customer_id, payment_method, item_count, subtotal, total, paid_offline, note, opened_at, created_by
  ) values (
    p_ticket_id,
    v_number,
    'Ticket ' || v_number,
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
