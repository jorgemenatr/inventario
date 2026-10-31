-- =====================================================================
-- Mostrador: tickets compartidos, preventas, combos y cancelaciones
--
-- 1. Tickets abiertos en la base (open_tickets + open_ticket_lines), con
--    realtime: se ven y se editan desde cualquier sesión o dispositivo.
-- 2. Preventas: un producto se marca como preventa con un anticipo mínimo
--    (porcentaje o monto por pieza). El ticket se cobra con un primer abono,
--    recibe su folio y queda en status 'preorder'; sus piezas quedan
--    comprometidas (preorder_reserved) aunque no hayan llegado. Se entrega
--    solo ya saldado: en ese momento salen de los lotes y la venta cuenta ese
--    día (paid_at).
-- 3. Abonos: ticket_payments guarda fecha, quién cobró y si es devolución.
--    Los cortes suman cada abono el día que se recibió.
-- 4. Combos: product_combo_options liga un combo a los refrescos que ya
--    existen. Al vender se elige uno; va a $0 y descuenta su inventario.
-- 5. Cancelaciones con registro (quién, cuándo, motivo): tickets abiertos,
--    preventas (cualquier usuario) y ventas cobradas (solo admin). Regresan
--    el inventario descontado y, si se pide, devuelven los pagos.
-- 6. Notas del ticket (tickets.notes) y nombre libre sin perfil de cliente
--    (tickets.customer_name).
--
-- checkout_ticket reemplaza a pay_ticket en la app (pay_ticket se conserva
-- para versiones anteriores abiertas en algún navegador).
-- =====================================================================

-- ---------------------------------------------------------------------
-- Configuración por tienda
-- ---------------------------------------------------------------------
alter table public.app_settings
  add column day_cutoff_hour          smallint not null default 5 check (day_cutoff_hour between 0 and 23),
  add column timezone                 text     not null default 'America/Mexico_City',
  add column preorder_credit_payments boolean  not null default true;

grant select (day_cutoff_hour, timezone, preorder_credit_payments) on public.app_settings to authenticated;
grant update (day_cutoff_hour, preorder_credit_payments) on public.app_settings to authenticated;

-- Día de operación: el día termina a la hora de corte (5:00), no a medianoche.
create function public.business_date(p_at timestamptz)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select ((p_at at time zone s.timezone) - make_interval(hours => s.day_cutoff_hour))::date
  from public.app_settings s;
$$;

revoke all on function public.business_date(timestamptz) from public, anon;
grant execute on function public.business_date(timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- Productos: preventa
-- ---------------------------------------------------------------------
alter table public.products
  add column is_preorder            boolean       not null default false,
  -- Anticipo mínimo: 'percent' (del precio) o 'amount' (pesos por pieza).
  add column preorder_deposit_type  text          not null default 'percent'
    check (preorder_deposit_type in ('percent', 'amount')),
  add column preorder_deposit_value numeric(12, 2) not null default 0 check (preorder_deposit_value >= 0),
  add constraint products_preorder_deposit_check
    check (preorder_deposit_type <> 'percent' or preorder_deposit_value <= 100),
  -- Las piezas de preventa se comprometen: el producto debe llevar inventario.
  add constraint products_preorder_track_stock_check check (not is_preorder or track_stock);

grant select (is_preorder, preorder_deposit_type, preorder_deposit_value) on public.products to authenticated;
grant insert (is_preorder, preorder_deposit_type, preorder_deposit_value) on public.products to authenticated;
grant update (is_preorder, preorder_deposit_type, preorder_deposit_value) on public.products to authenticated;

-- Solo un admin cambia la preventa (igual que el resto del producto).
create or replace function public.guard_products()
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
  -- Mostrador: solo puede cambiar la cantidad (ventas con checkout_ticket).
  if (new.barcode, new.name, new.category, new.supplier, new.supplier_id, new.cost, new.price, new.image_url,
      new.is_internal_code, new.description, new.catalog_product_id, new.track_stock,
      new.is_preorder, new.preorder_deposit_type, new.preorder_deposit_value)
     is distinct from
     (old.barcode, old.name, old.category, old.supplier, old.supplier_id, old.cost, old.price, old.image_url,
      old.is_internal_code, old.description, old.catalog_product_id, old.track_stock,
      old.is_preorder, old.preorder_deposit_type, old.preorder_deposit_value) then
    raise exception 'Solo un administrador puede editar productos' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- Combos: refrescos (u otras opciones) que se pueden elegir con cada combo.
-- Son productos existentes: comparten su inventario.
-- ---------------------------------------------------------------------
create table public.product_combo_options (
  combo_product_id  uuid not null references public.products (id) on delete cascade,
  option_product_id uuid not null references public.products (id) on delete cascade,
  position          integer not null default 0,
  primary key (combo_product_id, option_product_id),
  check (combo_product_id <> option_product_id)
);

create index product_combo_options_option_idx on public.product_combo_options (option_product_id);

alter table public.product_combo_options enable row level security;
revoke all on public.product_combo_options from anon, authenticated;
grant select, insert, update, delete on public.product_combo_options to authenticated;

create policy "combo_options: authenticated puede leer"
  on public.product_combo_options for select to authenticated using (true);
create policy "combo_options: admin puede agregar"
  on public.product_combo_options for insert to authenticated with check (public.is_admin());
create policy "combo_options: admin puede editar"
  on public.product_combo_options for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "combo_options: admin puede quitar"
  on public.product_combo_options for delete to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Clientes: apodos
-- ---------------------------------------------------------------------
alter table public.customers add column nicknames text[] not null default '{}';
grant select (nicknames) on public.customers to authenticated;
grant insert (nicknames) on public.customers to authenticated;
grant update (nicknames) on public.customers to authenticated;

-- ---------------------------------------------------------------------
-- Tickets (ventas): preventa, cancelación, notas y nombre libre
-- ---------------------------------------------------------------------
alter table public.tickets drop constraint tickets_status_check;
alter table public.tickets add constraint tickets_status_check check (status in ('paid', 'preorder', 'cancelled'));

-- paid_at = día de la venta. Una preventa no lo tiene hasta entregarse.
alter table public.tickets alter column paid_at drop not null;

alter table public.tickets
  -- Nombre escrito en el ticket sin perfil de cliente (solo sin customer_id).
  add column customer_name text,
  -- Notas del usuario (note queda para avisos del sistema).
  add column notes         text,
  add column cancelled_at  timestamptz,
  add column cancelled_by  uuid references auth.users (id) on delete set null,
  add column cancel_reason text,
  add constraint tickets_paid_at_check check (status <> 'paid' or paid_at is not null);

create index tickets_preorder_idx on public.tickets (created_at desc) where status = 'preorder';

alter table public.ticket_items
  -- Pieza de preventa: comprometida hasta que se entrega el ticket.
  add column preorder       boolean not null default false,
  -- Refresco elegido en un combo: renglón hijo a $0.
  add column parent_item_id uuid references public.ticket_items (id) on delete cascade;

-- El movimiento de venta apunta a su renglón (costo correcto si el mismo
-- producto va suelto y en combo dentro del ticket).
alter table public.inventory_movements
  add column ticket_item_id uuid references public.ticket_items (id) on delete restrict;

-- ---------- abonos y devoluciones ----------
alter table public.ticket_payments
  add column paid_at    timestamptz,
  add column created_by uuid references auth.users (id) on delete set null,
  add column kind       text not null default 'payment' check (kind in ('payment', 'refund')),
  -- Idempotencia de abonos (reintentos de red no cobran doble).
  add column op_id      uuid;

update public.ticket_payments p set paid_at = t.paid_at, created_by = t.created_by
from public.tickets t where t.id = p.ticket_id;

alter table public.ticket_payments
  alter column paid_at set not null,
  alter column paid_at set default now(),
  alter column created_by set default auth.uid(),
  drop constraint ticket_payments_amount_check,
  add constraint ticket_payments_amount_check
    check ((kind = 'payment' and amount > 0) or (kind = 'refund' and amount < 0));

create index ticket_payments_paid_idx on public.ticket_payments (paid_at desc);
create unique index ticket_payments_op_idx on public.ticket_payments (op_id, method) where op_id is not null;

-- Créditos devueltos al cancelar.
alter table public.customer_credit_movements
  drop constraint customer_credit_movements_kind_check,
  drop constraint customer_credit_movements_check,
  add constraint customer_credit_movements_kind_check check (kind in ('grant', 'sale', 'refund')),
  add constraint customer_credit_movements_check check (
    (kind = 'grant' and amount > 0 and length(btrim(coalesce(note, ''))) > 0)
    or (kind = 'sale' and amount < 0 and ticket_id is not null)
    or (kind = 'refund' and amount > 0 and ticket_id is not null)
  );

-- ---------------------------------------------------------------------
-- Piezas comprometidas en preventas (columna calculada de products: la app
-- la pide como products.preorder_reserved).
-- ---------------------------------------------------------------------
create function public.preorder_reserved(p public.products)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(ti.quantity), 0)::integer
  from public.ticket_items ti
  join public.tickets t on t.id = ti.ticket_id
  where ti.product_id = p.id and ti.preorder and t.status = 'preorder';
$$;

revoke all on function public.preorder_reserved(public.products) from public, anon;
grant execute on function public.preorder_reserved(public.products) to authenticated;

-- Producto para devolver a la app (sin costo y con lo comprometido).
create function public._product_json(p_product_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select (to_jsonb(p) - 'cost') || jsonb_build_object('preorder_reserved', public.preorder_reserved(p))
  from public.products p where p.id = p_product_id;
$$;

revoke all on function public._product_json(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Tickets abiertos compartidos
-- ---------------------------------------------------------------------
create table public.open_tickets (
  -- Lo genera la app; al cobrar es el id de la venta (idempotencia).
  id            uuid primary key,
  status        text not null default 'open' check (status in ('open', 'cancelled')),
  customer_id   uuid references public.customers (id) on delete set null,
  -- Nombre libre (sin perfil) o, con cliente, la copia de su nombre.
  customer_name text,
  notes         text,
  opened_at     timestamptz not null default now(),
  opened_by     uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid references auth.users (id) on delete set null,
  cancel_reason text
);

create index open_tickets_open_idx on public.open_tickets (opened_at) where status = 'open';

create table public.open_ticket_lines (
  -- Lo genera la app: cada dispositivo edita renglones por id (gana el último cambio).
  id                uuid primary key,
  ticket_id         uuid not null references public.open_tickets (id) on delete cascade,
  product_id        uuid not null references public.products (id) on delete cascade,
  -- Opción elegida del combo (refresco).
  choice_product_id uuid references public.products (id) on delete cascade,
  unit_price        numeric(12, 2) not null check (unit_price >= 0),
  quantity          integer not null check (quantity > 0),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index open_ticket_lines_ticket_idx on public.open_ticket_lines (ticket_id, created_at);

create trigger open_tickets_set_updated_at
  before update on public.open_tickets
  for each row execute function public.set_updated_at();
create trigger open_ticket_lines_set_updated_at
  before update on public.open_ticket_lines
  for each row execute function public.set_updated_at();

-- Un dispositivo que estuvo sin red no puede "revivir" un ticket que otro ya cobró.
create function public.guard_open_ticket()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.tickets where id = new.id) then
    raise exception 'Este ticket ya se cobró' using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger open_tickets_guard
  before insert on public.open_tickets
  for each row execute function public.guard_open_ticket();

revoke all on function public.guard_open_ticket() from public, anon, authenticated;

alter table public.open_tickets      enable row level security;
alter table public.open_ticket_lines enable row level security;
revoke all on public.open_tickets, public.open_ticket_lines from anon, authenticated;

grant select, delete on public.open_tickets to authenticated;
grant insert (id, customer_id, customer_name, notes, opened_at) on public.open_tickets to authenticated;
grant update (customer_id, customer_name, notes) on public.open_tickets to authenticated;
grant select, insert, update, delete on public.open_ticket_lines to authenticated;

create policy "open_tickets: authenticated puede leer"
  on public.open_tickets for select to authenticated using (true);
create policy "open_tickets: authenticated puede abrir"
  on public.open_tickets for insert to authenticated with check (status = 'open');
create policy "open_tickets: authenticated edita los abiertos"
  on public.open_tickets for update to authenticated using (status = 'open') with check (status = 'open');
-- Borrar solo tickets vacíos; con productos se cancelan (queda registro).
create policy "open_tickets: authenticated borra vacíos"
  on public.open_tickets for delete to authenticated
  using (status = 'open' and not exists (select 1 from public.open_ticket_lines l where l.ticket_id = open_tickets.id));

create policy "open_ticket_lines: authenticated puede leer"
  on public.open_ticket_lines for select to authenticated using (true);
create policy "open_ticket_lines: authenticated agrega en abiertos"
  on public.open_ticket_lines for insert to authenticated
  with check (exists (select 1 from public.open_tickets t where t.id = ticket_id and t.status = 'open'));
create policy "open_ticket_lines: authenticated edita en abiertos"
  on public.open_ticket_lines for update to authenticated
  using (exists (select 1 from public.open_tickets t where t.id = ticket_id and t.status = 'open'))
  with check (exists (select 1 from public.open_tickets t where t.id = ticket_id and t.status = 'open'));
create policy "open_ticket_lines: authenticated quita en abiertos"
  on public.open_ticket_lines for delete to authenticated
  using (exists (select 1 from public.open_tickets t where t.id = ticket_id and t.status = 'open'));

alter publication supabase_realtime add table public.open_tickets, public.open_ticket_lines;

-- ---------------------------------------------------------------------
-- Pagos: valida y agrupa por método. Devuelve [{method, amount}].
-- ---------------------------------------------------------------------
create function public._parse_payments(p_payments jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v jsonb;
begin
  if p_payments is null then
    return '[]'::jsonb;
  end if;
  if jsonb_typeof(p_payments) <> 'array' then
    raise exception 'Pagos inválidos' using errcode = '22023';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('method', method, 'amount', amount)), '[]'::jsonb)
  into v
  from (
    select e ->> 'method' as method, sum((e ->> 'amount')::numeric(12, 2)) as amount
    from jsonb_array_elements(p_payments) e
    group by e ->> 'method'
  ) g;
  if exists (
    select 1 from jsonb_to_recordset(v) as x(method text, amount numeric)
    where x.method is null or x.method not in ('cash', 'card', 'credit', 'transfer') or x.amount is null or x.amount <= 0
  ) then
    raise exception 'Hay pagos con método o monto inválido' using errcode = '22023';
  end if;
  return v;
end;
$$;

revoke all on function public._parse_payments(jsonb) from public, anon, authenticated;

-- Revisa y bloquea el saldo de créditos del cliente.
create function public._check_credit(p_customer_id uuid, p_amount numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_balance numeric(12, 2);
begin
  if p_amount <= 0 then
    return;
  end if;
  if p_customer_id is null then
    raise exception 'Para pagar con créditos el ticket necesita un cliente' using errcode = '22023';
  end if;
  perform 1 from public.customers where id = p_customer_id for update;
  if not found then
    raise exception 'No existe el cliente' using errcode = 'P0002';
  end if;
  select coalesce(sum(amount), 0) into v_balance
  from public.customer_credit_movements where customer_id = p_customer_id;
  if p_amount > v_balance then
    raise exception 'Créditos insuficientes: el cliente tiene % y se quieren usar %', v_balance, p_amount
      using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public._check_credit(uuid, numeric) from public, anon, authenticated;

-- Descuenta de la tienda un renglón ya registrado (movimiento + lotes FIFO).
create function public._sell_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item     public.ticket_items;
  v_ticket   public.tickets;
  v_product  public.products;
  v_movement public.inventory_movements;
begin
  select * into v_item from public.ticket_items where id = p_item_id;
  select * into v_ticket from public.tickets where id = v_item.ticket_id;
  select * into v_product from public.products where id = v_item.product_id;
  if not v_product.track_stock then
    return;
  end if;
  insert into public.inventory_movements (
    product_id, type, delta, quantity_after, note, ticket_id, ticket_item_id, created_by, location
  ) values (
    v_product.id, 'sale', -v_item.quantity, v_product.quantity - v_item.quantity,
    'Venta: ' || v_ticket.name || case when v_item.parent_item_id is not null then ' (combo)' else '' end,
    v_ticket.id, v_item.id, auth.uid(), 'store'
  )
  returning * into v_movement;
  perform public._take_auto(v_product.id, 'store', v_item.quantity, v_movement.id, false);
end;
$$;

revoke all on function public._sell_item(uuid) from public, anon, authenticated;

-- Revisa stock de tienda de varios productos (ya bloqueados).
--   p_needs: [{ "product_id": "...", "quantity": 3 }]
create function public._check_store_stock(p_needs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_short text;
begin
  select string_agg(format('%s (pide %s, hay %s en tienda%s)', p.name, n.qty, p.quantity,
           case when p.warehouse_quantity > 0 then format(' y %s en bodega: pide un movimiento', p.warehouse_quantity) else '' end),
         '; ')
  into v_short
  from (
    select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'quantity')::integer) as qty
    from jsonb_array_elements(p_needs) e group by 1
  ) n
  join public.products p on p.id = n.product_id
  where p.track_stock and n.qty > p.quantity;
  if v_short is not null then
    raise exception 'Stock insuficiente: %', v_short using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public._check_store_stock(jsonb) from public, anon, authenticated;

-- Método del ticket según todos sus pagos.
create function public._ticket_method(p_ticket_id uuid, p_fallback public.payment_method)
returns public.payment_method
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when count(distinct method) > 1 then 'mixed'::public.payment_method
    when count(distinct method) = 1 then min(method::text)::public.payment_method
    else coalesce(p_fallback, 'cash')
  end
  from public.ticket_payments where ticket_id = p_ticket_id and kind = 'payment';
$$;

revoke all on function public._ticket_method(uuid, public.payment_method) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- checkout_ticket: cobra un ticket abierto (venta normal o preventa).
--   p_items: [{ "product_id": "...", "quantity": 2, "unit_price": 89,
--               "choice_product_id": "..." (refresco del combo, opcional) }]
--   p_payments: [{ "method": "cash", "amount": 500 }, ...]
-- Sin productos de preventa: los pagos deben sumar el total (status 'paid').
-- Con preventa: el primer abono cubre al menos los productos normales más el
--   anticipo de los de preventa (status 'preorder', paid_at nulo).
-- Borra el ticket abierto en la misma transacción.
-- status: 'ok' | 'duplicate'
-- ---------------------------------------------------------------------
create function public.checkout_ticket(
  p_ticket_id     uuid,
  p_items         jsonb,
  p_payments      jsonb,
  p_customer_id   uuid default null,
  p_customer_name text default null,
  p_notes         text default null,
  p_opened_at     timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket      public.tickets;
  v_settings    public.app_settings;
  v_item        record;
  v_item_id     uuid;
  v_child_id    uuid;
  v_payments    jsonb;
  v_paid        numeric(12, 2);
  v_credit      numeric(12, 2);
  v_total       numeric(12, 2);
  v_minimum     numeric(12, 2);
  v_count       integer;
  v_preorder    boolean;
  v_number      bigint;
  v_needs       jsonb;
  v_products    jsonb := '[]'::jsonb;
  v_position    integer := 0;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id;
  if found then
    return jsonb_build_object('status', 'duplicate', 'ticket', to_jsonb(v_ticket), 'products', '[]'::jsonb);
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'El ticket no tiene productos' using errcode = '22023';
  end if;

  drop table if exists pg_temp._co_items;
  create temp table _co_items on commit drop as
  select
    ord::integer                              as position,
    (e ->> 'product_id')::uuid                as product_id,
    (e ->> 'quantity')::integer               as quantity,
    (e ->> 'unit_price')::numeric(12, 2)      as unit_price,
    nullif(e ->> 'choice_product_id', '')::uuid as choice_product_id
  from jsonb_array_elements(p_items) with ordinality as t(e, ord);

  if exists (select 1 from _co_items where product_id is null or quantity is null or quantity <= 0
                                          or unit_price is null or unit_price < 0) then
    raise exception 'Hay productos con datos inválidos en el ticket' using errcode = '22023';
  end if;
  if exists (select 1 from _co_items i where not exists (select 1 from public.products p where p.id = i.product_id))
     or exists (select 1 from _co_items i where i.choice_product_id is not null
                and not exists (select 1 from public.products p where p.id = i.choice_product_id)) then
    raise exception 'Uno de los productos ya no existe' using errcode = 'P0002';
  end if;
  if exists (select 1 from _co_items i where i.choice_product_id is not null
             and not exists (select 1 from public.product_combo_options o
                             where o.combo_product_id = i.product_id and o.option_product_id = i.choice_product_id)) then
    raise exception 'El refresco elegido no es una opción de ese combo' using errcode = '22023';
  end if;

  -- Bloquea los productos en orden fijo (evita interbloqueos).
  perform 1 from public.products
  where id in (select product_id from _co_items union select choice_product_id from _co_items where choice_product_id is not null)
  order by id
  for update;

  -- Se descuenta ahora: productos normales y refrescos de combo. Lo de
  -- preventa solo se compromete.
  select coalesce(jsonb_agg(jsonb_build_object('product_id', n.product_id, 'quantity', n.quantity)), '[]'::jsonb)
  into v_needs
  from (
    select i.product_id, i.quantity from _co_items i join public.products p on p.id = i.product_id where not p.is_preorder
    union all
    select i.choice_product_id, i.quantity from _co_items i where i.choice_product_id is not null
  ) n;
  perform public._check_store_stock(v_needs);

  select
    sum(i.quantity),
    sum(i.quantity * i.unit_price),
    bool_or(p.is_preorder),
    sum(case
      when not p.is_preorder then i.quantity * i.unit_price
      when p.preorder_deposit_type = 'percent' then round(i.quantity * i.unit_price * p.preorder_deposit_value / 100, 2)
      else least(i.quantity * i.unit_price, i.quantity * p.preorder_deposit_value)
    end)
  into v_count, v_total, v_preorder, v_minimum
  from _co_items i join public.products p on p.id = i.product_id;

  -- ---------- pagos ----------
  v_payments := public._parse_payments(p_payments);
  select coalesce(sum(x.amount), 0), coalesce(sum(x.amount) filter (where x.method = 'credit'), 0)
  into v_paid, v_credit
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if not v_preorder and v_paid <> v_total then
    raise exception 'Los pagos (%) no suman el total del ticket (%)', v_paid, v_total using errcode = '22023';
  end if;
  if v_preorder then
    if v_paid > v_total then
      raise exception 'El abono (%) es mayor que el total del ticket (%)', v_paid, v_total using errcode = '22023';
    end if;
    if v_paid < v_minimum or (v_total > 0 and v_paid <= 0) then
      raise exception 'El primer abono de la preventa debe ser de al menos %', greatest(v_minimum, 0.01) using errcode = '22023';
    end if;
    select * into v_settings from public.app_settings;
    if v_credit > 0 and not coalesce(v_settings.preorder_credit_payments, true) then
      raise exception 'Esta tienda no acepta créditos en abonos de preventa' using errcode = '22023';
    end if;
  end if;
  perform public._check_credit(p_customer_id, v_credit);

  v_number := public._next_ticket_number();

  insert into public.tickets (
    id, number, name, status, customer_id, customer_name, payment_method, item_count, subtotal, total,
    paid_offline, notes, opened_at, paid_at, created_by
  ) values (
    p_ticket_id, v_number, v_number::text,
    case when v_preorder then 'preorder' else 'paid' end,
    p_customer_id,
    case when p_customer_id is null then nullif(btrim(coalesce(p_customer_name, '')), '') end,
    case
      when jsonb_array_length(v_payments) > 1 then 'mixed'::public.payment_method
      when jsonb_array_length(v_payments) = 1 then (v_payments -> 0 ->> 'method')::public.payment_method
      else 'cash'::public.payment_method
    end,
    v_count, v_total, v_total, false,
    nullif(btrim(coalesce(p_notes, '')), ''),
    p_opened_at,
    case when v_preorder then null else now() end,
    auth.uid()
  )
  returning * into v_ticket;

  for v_item in
    select i.*, p.name as product_name, p.barcode, p.is_preorder,
           c.name as choice_name, c.barcode as choice_barcode
    from _co_items i
    join public.products p on p.id = i.product_id
    left join public.products c on c.id = i.choice_product_id
    order by i.position
  loop
    v_position := v_position + 1;
    insert into public.ticket_items (ticket_id, product_id, barcode, product_name, quantity, unit_price, position, preorder)
    values (v_ticket.id, v_item.product_id, v_item.barcode, v_item.product_name, v_item.quantity, v_item.unit_price,
            v_position, v_item.is_preorder)
    returning id into v_item_id;
    if not v_item.is_preorder then
      perform public._sell_item(v_item_id);
    end if;

    if v_item.choice_product_id is not null then
      v_position := v_position + 1;
      insert into public.ticket_items (ticket_id, product_id, barcode, product_name, quantity, unit_price, position, parent_item_id)
      values (v_ticket.id, v_item.choice_product_id, v_item.choice_barcode, v_item.choice_name, v_item.quantity, 0,
              v_position, v_item_id)
      returning id into v_child_id;
      perform public._sell_item(v_child_id);
    end if;
  end loop;

  insert into public.ticket_payments (ticket_id, method, amount, paid_at, created_by, kind)
  select v_ticket.id, x.method::public.payment_method, x.amount, now(), auth.uid(), 'payment'
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if v_credit > 0 then
    insert into public.customer_credit_movements (customer_id, kind, amount, note, ticket_id, created_by)
    values (p_customer_id, 'sale', -v_credit,
            case when v_preorder then 'Abono preventa: ' else 'Compra: ' end || v_ticket.name, v_ticket.id, auth.uid());
  end if;

  delete from public.open_tickets where id = p_ticket_id;

  select coalesce(jsonb_agg(public._product_json(x.id)), '[]'::jsonb) into v_products
  from (select product_id as id from _co_items union select choice_product_id from _co_items where choice_product_id is not null) x;

  return jsonb_build_object(
    'status', 'ok', 'ticket', to_jsonb(v_ticket), 'products', v_products, 'payments', v_payments,
    'balance', v_total - v_paid
  );
end;
$$;

revoke all on function public.checkout_ticket(uuid, jsonb, jsonb, uuid, text, text, timestamptz) from public, anon;
grant execute on function public.checkout_ticket(uuid, jsonb, jsonb, uuid, text, text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------
-- add_ticket_payment: abono a una preventa y, opcionalmente, su entrega.
--   p_payments puede ir vacío para solo entregar una preventa ya saldada.
--   p_deliver: entrega (solo saldada): las piezas de preventa salen de la
--   tienda y la venta cuenta hoy (paid_at).
--   p_op_id: idempotencia (un reintento no cobra doble).
-- ---------------------------------------------------------------------
create function public.add_ticket_payment(
  p_ticket_id uuid,
  p_payments  jsonb,
  p_deliver   boolean default false,
  p_op_id     uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket   public.tickets;
  v_payments jsonb;
  v_paid     numeric(12, 2);
  v_credit   numeric(12, 2);
  v_prev     numeric(12, 2);
  v_balance  numeric(12, 2);
  v_needs    jsonb;
  v_products jsonb := '[]'::jsonb;
  r          record;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'No existe el ticket' using errcode = 'P0002';
  end if;

  if p_op_id is not null and exists (select 1 from public.ticket_payments where op_id = p_op_id) then
    return jsonb_build_object('status', 'duplicate', 'ticket', to_jsonb(v_ticket), 'products', '[]'::jsonb);
  end if;
  if v_ticket.status <> 'preorder' then
    raise exception 'El ticket % no es una preventa pendiente', v_ticket.name using errcode = '22023';
  end if;

  v_payments := public._parse_payments(p_payments);
  select coalesce(sum(x.amount), 0), coalesce(sum(x.amount) filter (where x.method = 'credit'), 0)
  into v_paid, v_credit
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  select coalesce(sum(amount), 0) into v_prev from public.ticket_payments where ticket_id = p_ticket_id;
  v_balance := v_ticket.total - v_prev;

  if v_paid = 0 and not coalesce(p_deliver, false) then
    raise exception 'Falta el monto del abono' using errcode = '22023';
  end if;
  if v_paid > v_balance then
    raise exception 'El abono (%) es mayor que el saldo (%)', v_paid, v_balance using errcode = '22023';
  end if;
  if v_credit > 0 and not coalesce((select preorder_credit_payments from public.app_settings), true) then
    raise exception 'Esta tienda no acepta créditos en abonos de preventa' using errcode = '22023';
  end if;
  perform public._check_credit(v_ticket.customer_id, v_credit);

  insert into public.ticket_payments (ticket_id, method, amount, paid_at, created_by, kind, op_id)
  select p_ticket_id, x.method::public.payment_method, x.amount, now(), auth.uid(), 'payment', p_op_id
  from jsonb_to_recordset(v_payments) as x(method text, amount numeric);

  if v_credit > 0 then
    insert into public.customer_credit_movements (customer_id, kind, amount, note, ticket_id, created_by)
    values (v_ticket.customer_id, 'sale', -v_credit, 'Abono preventa: ' || v_ticket.name, p_ticket_id, auth.uid());
  end if;

  v_balance := v_balance - v_paid;

  if coalesce(p_deliver, false) then
    if v_balance > 0 then
      raise exception 'Solo se entrega una preventa saldada: faltan %', v_balance using errcode = '22023';
    end if;

    perform 1 from public.products
    where id in (select product_id from public.ticket_items where ticket_id = p_ticket_id and preorder)
    order by id
    for update;

    select coalesce(jsonb_agg(jsonb_build_object('product_id', product_id, 'quantity', quantity)), '[]'::jsonb)
    into v_needs
    from public.ticket_items where ticket_id = p_ticket_id and preorder;
    perform public._check_store_stock(v_needs);

    -- Al cambiar el status dejan de contar como comprometidas.
    update public.tickets set status = 'paid', paid_at = now() where id = p_ticket_id;

    for r in select id from public.ticket_items where ticket_id = p_ticket_id and preorder order by position loop
      perform public._sell_item(r.id);
    end loop;
  end if;

  update public.tickets set payment_method = public._ticket_method(p_ticket_id, payment_method)
  where id = p_ticket_id
  returning * into v_ticket;

  select coalesce(jsonb_agg(public._product_json(x.product_id)), '[]'::jsonb) into v_products
  from (select distinct product_id from public.ticket_items where ticket_id = p_ticket_id and preorder) x;

  return jsonb_build_object('status', 'ok', 'ticket', to_jsonb(v_ticket), 'products', v_products, 'balance', v_balance);
end;
$$;

revoke all on function public.add_ticket_payment(uuid, jsonb, boolean, uuid) from public, anon;
grant execute on function public.add_ticket_payment(uuid, jsonb, boolean, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- cancel_ticket: cancela una preventa (cualquier usuario) o una venta
-- cobrada (solo admin). Regresa a sus lotes lo que se había descontado y,
-- con p_refund, devuelve los pagos (créditos al saldo del cliente; lo demás
-- como devolución del día).
-- ---------------------------------------------------------------------
create function public.cancel_ticket(p_ticket_id uuid, p_reason text default null, p_refund boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket   public.tickets;
  v_movement public.inventory_movements;
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  m          record;
  l          record;
  v_credit   numeric(12, 2);
  v_products jsonb := '[]'::jsonb;
begin
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'No existe el ticket' using errcode = 'P0002';
  end if;
  if v_ticket.status = 'cancelled' then
    return jsonb_build_object('status', 'already_cancelled', 'ticket', to_jsonb(v_ticket), 'products', '[]'::jsonb);
  end if;
  if v_ticket.status = 'paid' then
    perform public._require_admin();
  end if;

  perform 1 from public.products
  where id in (select product_id from public.ticket_items where ticket_id = p_ticket_id)
  order by id
  for update;

  -- Inventario: cada venta regresa a los mismos lotes de donde salió.
  for m in
    select im.* from public.inventory_movements im
    where im.ticket_id = p_ticket_id and im.type = 'sale'
      and not exists (select 1 from public.inventory_movements r where r.reverts_movement_id = im.id)
    order by im.created_at
  loop
    insert into public.inventory_movements (
      product_id, type, delta, quantity_after, note, reverts_movement_id, ticket_id, ticket_item_id, created_by, location
    ) values (
      m.product_id, 'adjustment', -m.delta, public._location_qty(m.product_id, m.location) - m.delta,
      'Cancelación de venta ' || v_ticket.name || coalesce('. Motivo: ' || v_reason, ''),
      m.id, p_ticket_id, m.ticket_item_id, auth.uid(), m.location
    )
    returning * into v_movement;

    for l in select lot_id, location, -delta as qty from public.movement_lots where movement_id = m.id and delta < 0 loop
      perform public._lot_add(l.lot_id, l.location, l.qty, v_movement.id);
    end loop;
  end loop;

  -- Pagos.
  if coalesce(p_refund, true) then
    insert into public.ticket_payments (ticket_id, method, amount, paid_at, created_by, kind)
    select p_ticket_id, method, -sum(amount), now(), auth.uid(), 'refund'
    from public.ticket_payments where ticket_id = p_ticket_id and method <> 'credit'
    group by method having sum(amount) > 0;

    select coalesce(sum(amount), 0) into v_credit
    from public.ticket_payments where ticket_id = p_ticket_id and method = 'credit';
    if v_credit > 0 then
      insert into public.ticket_payments (ticket_id, method, amount, paid_at, created_by, kind)
      values (p_ticket_id, 'credit', -v_credit, now(), auth.uid(), 'refund');
      insert into public.customer_credit_movements (customer_id, kind, amount, note, ticket_id, created_by)
      values (v_ticket.customer_id, 'refund', v_credit, 'Cancelación: ' || v_ticket.name, p_ticket_id, auth.uid());
    end if;
  end if;

  update public.tickets
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(), cancel_reason = v_reason
  where id = p_ticket_id
  returning * into v_ticket;

  select coalesce(jsonb_agg(public._product_json(x.product_id)), '[]'::jsonb) into v_products
  from (select distinct product_id from public.ticket_items where ticket_id = p_ticket_id) x;

  return jsonb_build_object('status', 'ok', 'ticket', to_jsonb(v_ticket), 'products', v_products);
end;
$$;

revoke all on function public.cancel_ticket(uuid, text, boolean) from public, anon;
grant execute on function public.cancel_ticket(uuid, text, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- cancel_open_ticket: cancela un ticket abierto (aún sin cobrar). No hay
-- inventario que regresar; queda registrado quién, cuándo y el motivo.
-- ---------------------------------------------------------------------
create function public.cancel_open_ticket(p_ticket_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.open_tickets;
begin
  update public.open_tickets
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
      cancel_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_ticket_id and status = 'open'
  returning * into v_ticket;
  if not found then
    return jsonb_build_object('status', 'not_open');
  end if;
  return jsonb_build_object('status', 'ok', 'ticket', to_jsonb(v_ticket));
end;
$$;

revoke all on function public.cancel_open_ticket(uuid, text) from public, anon;
grant execute on function public.cancel_open_ticket(uuid, text) to authenticated;

-- Notas de una venta o preventa ya registrada.
create function public.set_ticket_notes(p_ticket_id uuid, p_notes text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.tickets set notes = nullif(btrim(coalesce(p_notes, '')), '') where id = p_ticket_id;
$$;

revoke all on function public.set_ticket_notes(uuid, text) from public, anon;
grant execute on function public.set_ticket_notes(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- Vistas
-- ---------------------------------------------------------------------
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
  coalesce(c.name, t.customer_name) as customer_name,
  t.created_by,
  pr.email     as created_by_email,
  pr.full_name as created_by_name,
  t.number,
  t.notes,
  t.created_at,
  (t.customer_id is null and t.customer_name is not null) as customer_is_free_name,
  coalesce(pay.paid, 0)                                     as paid_amount,
  case when t.status = 'cancelled' then 0 else t.total - coalesce(pay.paid, 0) end as balance,
  t.cancelled_at,
  t.cancel_reason,
  cb.full_name as cancelled_by_name,
  cb.email     as cancelled_by_email
from public.tickets t
left join public.customers c on c.id = t.customer_id
left join public.profiles pr on pr.id = t.created_by
left join public.profiles cb on cb.id = t.cancelled_by
left join lateral (
  select sum(p.amount) filter (where p.kind = 'payment') as paid from public.ticket_payments p where p.ticket_id = t.id
) pay on true;

-- Cada abono o devolución cuenta el día en que se recibió.
create or replace view public.sales_payments
with (security_invoker = true)
as
select
  p.ticket_id,
  p.method,
  p.amount,
  p.paid_at,
  t.customer_id,
  t.payment_method,
  p.kind,
  p.id,
  p.created_by,
  t.status as ticket_status
from public.ticket_payments p
join public.tickets t on t.id = p.ticket_id;

create or replace view public.sale_item_profit
with (security_invoker = true)
as
select
  ti.id         as ticket_item_id,
  ti.ticket_id,
  ti.product_id,
  ti.quantity,
  ti.unit_price,
  ti.line_total as revenue,
  coalesce(c.cost, 0) as cost,
  ti.line_total - coalesce(c.cost, 0) as profit
from public.ticket_items ti
left join lateral (
  select sum(-ml.delta * ml.unit_cost) as cost
  from public.inventory_movements m
  join public.movement_lots ml on ml.movement_id = m.id
  where m.ticket_id = ti.ticket_id and m.type = 'sale'
    and (m.ticket_item_id = ti.id or (m.ticket_item_id is null and m.product_id = ti.product_id))
) c on true;
