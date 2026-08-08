-- Registrations, add-on purchases and payments for the whole catalog.
--
-- THE INVARIANT: categories.slots_taken must equal the number of PAID
-- registrations on that category. That is what confirm_payment_tx and
-- refund_registration_tx maintain in production (one increments, the other
-- decrements), and it is the number the public site renders as "slots left".
-- Seeded data that ignores it makes every remaining-slot count on the site a
-- lie, which is the whole reason this file exists.
--
-- So this generates exactly `slots_taken - already_paid` paid rows per
-- category, and everything else it adds (pending, failed, refunded) is
-- deliberately OUTSIDE that count — matching production, where a pending entry
-- holds no slot and a refunded one has already given its slot back.
--
-- Re-runnable: every seeded registration carries id prefix
-- 00000000-0000-4000-900x-, the paid pass only creates the shortfall, and the
-- extras are sized off the (already stable) paid count. A second run is a no-op.

begin;

-- Inserting ~5,500 registrations would otherwise fan out ~5,500 "you're
-- registered" notifications, none of which describe anything that just
-- happened. Curated notifications are seeded in 04 instead.
alter table registrations disable trigger trg_registrations_notify;

-- ── How many paid rows each category is short ───────────────────────────────
-- A TABLE, not a view. `n_paid` is defined against the very rows the next
-- statement inserts, so a view would re-evaluate to zero the moment they land.
--
-- `ev_idx` is a per-EVENT running index across that event's categories. It is
-- what keeps one runner off the same start list twice: the runner is chosen by
-- (event seed + ev_idx) mod 1200, and no event's field exceeds 700.
create temporary table seed_need as
select
  c.id                                            as category_id,
  c.event_id,
  c.org_id,
  c.base_price,
  e.event_date,
  e.status                                        as event_status,
  abs(hashtext(c.event_id::text)) % 1200          as ev_seed,
  greatest(c.slots_taken - coalesce((
    select count(*) from registrations r
    where r.category_id = c.id and r.status = 'paid'), 0), 0) as n_paid,
  coalesce(sum(greatest(c.slots_taken - coalesce((
    select count(*) from registrations r2
    where r2.category_id = c.id and r2.status = 'paid'), 0), 0))
    over (partition by c.event_id order by c.base_price desc, c.id
          rows between unbounded preceding and 1 preceding), 0) as prev_paid
from categories c
join events e on e.id = c.event_id;

-- ── Paid entries ────────────────────────────────────────────────────────────
with rows_ as (
  select
    n.*, g.k,
    n.prev_paid + g.k - 1 as ev_idx,
    row_number() over (order by n.event_id, n.base_price desc, n.category_id, g.k) as seq
  from seed_need n, lateral generate_series(1, n.n_paid) g(k)
),
built as (
  select
    r.*,
    ('00000000-0000-4000-9001-' || lpad(r.seq::text, 12, '0'))::uuid as rid,
    ('00000000-0000-4000-8000-' || lpad((1 + (r.ev_seed + r.ev_idx) % 1200)::text, 12, '0'))::uuid as uid,
    -- Entries land before the race and never in the future, whichever binds.
    least(r.event_date::timestamptz - interval '3 days', now() - interval '1 day')
      - ((r.ev_idx * 7919) % 150) * interval '1 day'
      - ((r.ev_idx * 104729) % 86400) * interval '1 second' as made_at
  from rows_ r
)
insert into registrations (
  id, org_id, event_id, category_id, user_id, status,
  total_amount, custom_data, waiver_accepted_at, idempotency_key, created_at
)
select
  b.rid, b.org_id, b.event_id, b.category_id, b.uid, 'paid',
  b.base_price + case when abs(hashtext(b.rid::text)) % 4 = 1
                      then coalesce(ad.price, 0) else 0 end,
  jsonb_strip_nulls(jsonb_build_object(
    'blood_type',         p.blood_type,
    'shirt_size',         p.shirt_size,
    'running_club',       (array['Bukidnon Trail Runners','Malaybalay Runners Club',
                                 'Valencia Road Warriors','Kaamulan Pacers','Team Kitanglad',
                                 'Northern Mindanao Ultra', null, null])[1 + abs(hashtext(b.rid::text)) % 8],
    'emergency_relation', (array['Spouse','Parent','Sibling','Partner','Friend','Child'])[
                            1 + abs(hashtext(b.rid::text || 'rel')) % 6]
  )),
  b.made_at + interval '2 minutes',
  'seed-' || b.rid::text,
  b.made_at
from built b
join profiles p on p.id = b.uid
left join lateral (
  select a.price from addons a where a.event_id = b.event_id order by a.price, a.id limit 1
) ad on true
on conflict (id) do nothing;

-- ── A cancelled race refunded everyone ──────────────────────────────────────
-- refund_registration_tx gives the slot back, so slots_taken must be 0 — not the
-- pre-cancellation figure. Done BEFORE the extras are sized, so the extras see
-- the same paid counts on every run.
update registrations r
set status = 'refunded'
from events e
where e.id = r.event_id and e.status = 'cancelled' and r.status = 'paid';

update categories c
set slots_taken = 0
from events e
where e.id = c.event_id and e.status = 'cancelled' and c.slots_taken <> 0;

-- ── Pending, failed and refunded entries ────────────────────────────────────
-- None of these hold a slot, so they are generated off a separate index base
-- (800/900/1000) that cannot collide with the paid block (0-699) above.
-- Sized off the PAID count, which is stable once the pass above has run.
create temporary table seed_extra as
select
  n.category_id, n.event_id, n.org_id, n.base_price, n.event_date, n.ev_seed,
  round(paid.n * 0.055)::int as n_pending,
  round(paid.n * 0.022)::int as n_failed,
  round(paid.n * 0.013)::int as n_refund,
  coalesce(sum(round(paid.n * 0.055)::int) over w, 0) as prev_pending,
  coalesce(sum(round(paid.n * 0.022)::int) over w, 0) as prev_failed,
  coalesce(sum(round(paid.n * 0.013)::int) over w, 0) as prev_refund
from seed_need n
cross join lateral (
  select count(*) as n from registrations r
  where r.category_id = n.category_id and r.status = 'paid'
) paid
window w as (partition by n.event_id order by n.base_price desc, n.category_id
             rows between unbounded preceding and 1 preceding);

do $$
declare
  v_kind text;
  v_slot int;
  v_pfx  text;
begin
  foreach v_kind in array array['pending', 'failed', 'refund'] loop
    v_slot := case v_kind when 'pending' then 800 when 'failed' then 900 else 1000 end;
    v_pfx  := case v_kind when 'pending' then '9002' when 'failed' then '9003' else '9004' end;

    execute format($f$
      with rows_ as (
        select x.category_id, x.event_id, x.org_id, x.base_price, x.event_date, x.ev_seed,
               %2$L::int + case %1$L when 'pending' then x.prev_pending
                                     when 'failed'  then x.prev_failed
                                     else x.prev_refund end + g.k - 1 as ev_idx,
               row_number() over (order by x.event_id, x.base_price desc, x.category_id, g.k) as seq
        from seed_extra x,
             lateral generate_series(1, case %1$L when 'pending' then x.n_pending
                                                 when 'failed'  then x.n_failed
                                                 else x.n_refund end) g(k)
      ),
      built as (
        select r.*,
               ('00000000-0000-4000-%3$s-' || lpad(r.seq::text, 12, '0'))::uuid as rid,
               ('00000000-0000-4000-8000-' || lpad((1 + (r.ev_seed + r.ev_idx) %% 1200)::text, 12, '0'))::uuid as uid,
               least(r.event_date::timestamptz - interval '2 days', now() - interval '2 hours')
                 - ((r.ev_idx * 6577) %% 90) * interval '1 day'
                 - ((r.ev_idx * 104729) %% 86400) * interval '1 second' as made_at
        from rows_ r
      )
      insert into registrations (
        id, org_id, event_id, category_id, user_id, status,
        total_amount, custom_data, waiver_accepted_at, idempotency_key, created_at
      )
      select b.rid, b.org_id, b.event_id, b.category_id, b.uid,
             (case %1$L when 'pending' then 'pending'
                        when 'failed'  then 'cancelled'
                        else 'refunded' end)::registration_status,
             b.base_price,
             jsonb_strip_nulls(jsonb_build_object(
               'blood_type', p.blood_type,
               'shirt_size', p.shirt_size,
               'emergency_relation', (array['Spouse','Parent','Sibling','Partner','Friend','Child'])[
                                       1 + abs(hashtext(b.rid::text || 'rel')) %% 6]
             )),
             case when %1$L = 'pending' then null else b.made_at + interval '2 minutes' end,
             'seed-' || b.rid::text,
             b.made_at
      from built b
      join profiles p on p.id = b.uid
      on conflict (id) do nothing
    $f$, v_kind, v_slot, v_pfx);
  end loop;
end $$;

-- ── Add-on purchases ────────────────────────────────────────────────────────
-- Same predicate the paid pass used to inflate total_amount, so the line items
-- add up to the amount charged.
insert into registration_addons (registration_id, addon_id, price)
select r.id, ad.id, ad.price
from registrations r
join lateral (
  select a.id, a.price from addons a where a.event_id = r.event_id order by a.price, a.id limit 1
) ad on true
where r.id::text like '00000000-0000-4000-9001-%'
  and abs(hashtext(r.id::text)) % 4 = 1
on conflict (registration_id, addon_id) do nothing;

-- ── Payments ────────────────────────────────────────────────────────────────
-- The fee is struck from the ORGANIZATION's terms, exactly as _shared/confirm.ts
-- does it, so the Commission and Payouts pages in the admin console reconcile.
insert into payments (
  org_id, registration_id, provider, provider_ref, method,
  amount, platform_fee, net_to_org, status, raw, checkout_url,
  refunded_amount, created_at
)
select
  r.org_id, r.id, 'paymongo',
  'cs_seed_' || substr(md5(r.id::text), 1, 20),
  case when r.status = 'pending' then null else m.method end,
  r.total_amount,
  case when r.status in ('paid', 'refunded') then f.fee else 0 end,
  case when r.status in ('paid', 'refunded') then r.total_amount - f.fee else 0 end,
  (case r.status when 'paid' then 'paid'
                 when 'pending' then 'pending'
                 when 'cancelled' then 'failed'
                 else 'refunded' end)::payment_status,
  jsonb_build_object(
    'seeded', true,
    'data', jsonb_build_object(
      'id', 'cs_seed_' || substr(md5(r.id::text), 1, 20),
      'attributes', jsonb_build_object(
        'status', case when r.status = 'paid' then 'paid' else 'unpaid' end,
        'payments', jsonb_build_array(jsonb_build_object(
          'attributes', jsonb_build_object(
            'source', jsonb_build_object('type', m.method))))))),
  case when r.status = 'pending'
       then 'https://checkout.paymongo.com/cs_seed_' || substr(md5(r.id::text), 1, 20)
       else null end,
  case when r.status = 'refunded' then r.total_amount else 0 end,
  r.created_at + interval '4 minutes'
from registrations r
join organizations o on o.id = r.org_id
cross join lateral (select (array['gcash','gcash','gcash','gcash','card','card','card',
                                  'paymaya','paymaya','grab_pay'])[
                             1 + abs(hashtext(r.id::text || 'm')) % 10] as method) m
cross join lateral (select case when o.commission_type = 'percent'
                                then round(r.total_amount * o.commission_rate)::int
                                else o.commission_flat_cents end as fee) f
where r.id::text like '00000000-0000-4000-900%'
on conflict (registration_id) do nothing;

-- A registration flipped to refunded by the cancelled-race pass above may have
-- had its payment written on an earlier run, while it was still paid.
update payments p
set status = 'refunded', refunded_amount = p.amount
from registrations r
where r.id = p.registration_id and r.status = 'refunded' and p.status = 'paid';

-- ── Tickets ─────────────────────────────────────────────────────────────────
-- Same construction as mintTicketToken() in supabase/functions/_shared/ticket.ts:
-- base64url(JSON) + "." + base64url(HMAC-SHA256(body)).
--
-- Signed with the literal 'dev-secret' — the fallback those functions use when
-- TICKET_SIGNING_SECRET is unset. The hosted project HAS that secret set and its
-- value is not readable back out of the Management API, so a seeded QR will not
-- verify against the hosted check-in function. Seeded check-ins are therefore
-- written straight into `checkins` in 04.
update registrations r
set ticket_token = b.body || '.' || rtrim(translate(replace(
      encode(extensions.hmac(b.body, 'dev-secret', 'sha256'), 'base64'), E'\n', ''),
      '+/', '-_'), '=')
from (
  select r2.id,
         rtrim(translate(replace(encode(convert_to(
           jsonb_build_object('rid', r2.id, 'eid', r2.event_id,
                              'iat', extract(epoch from r2.created_at)::bigint)::text,
           'utf8'), 'base64'), E'\n', ''), '+/', '-_'), '=') as body
  from registrations r2
  where r2.id::text like '00000000-0000-4000-900%'
    and r2.status in ('paid', 'refunded')
    and r2.ticket_token is null
) b
where r.id = b.id;

alter table registrations enable trigger trg_registrations_notify;
commit;

-- Final check: every category's paid count must equal its slots_taken.
select count(*) as categories_out_of_sync
from categories c
where c.slots_taken <> (
  select count(*) from registrations r where r.category_id = c.id and r.status = 'paid');
