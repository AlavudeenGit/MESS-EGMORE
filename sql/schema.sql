-- ============================================================================
-- MESS MEAL BOOKING SYSTEM — DATABASE SCHEMA (PostgreSQL / Supabase)
-- ============================================================================
-- Run this in the Supabase SQL editor (or via `supabase db push`).
-- Order matters: extensions -> tables -> indexes -> functions -> triggers -> RLS.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. EXTENSIONS + TIMEZONE
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- This app's every date/deadline concept (booking_close_time, confirmation_
-- deadline, "today"/"tomorrow" in enforce_booking_write() below) is meant
-- in India Standard Time. Postgres defaults to UTC, which is 5.5 hours
-- behind IST — current_date would flip to the next day at 5:30am IST
-- instead of midnight, silently shifting every deadline. Run this once
-- per database (takes effect on new connections):
--   alter database postgres set timezone to 'Asia/Kolkata';
-- (Supabase's SQL Editor runs as the `postgres` role, so the statement
-- below applies it directly; re-run it if your database name differs.)
alter database postgres set timezone to 'Asia/Kolkata';

-- ---------------------------------------------------------------------------
-- 1. ADMINS  (kept separate from students; linked 1:1 to auth.users)
-- ---------------------------------------------------------------------------
create table if not exists admins (
  id            uuid primary key references auth.users(id) on delete cascade,
  name          text not null,
  mobile        text,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2. STUDENTS  (linked 1:1 to auth.users once approved)
-- ---------------------------------------------------------------------------
create table if not exists students (
  id              uuid primary key references auth.users(id) on delete cascade,
  name            text not null,
  room_number     text not null,
  mobile          text not null,
  email           text not null unique,
  status          text not null default 'pending'
                    check (status in ('pending', 'active', 'inactive', 'rejected')),
  joined_at       date not null default current_date,
  deactivated_at  date,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_students_status on students(status);
create index if not exists idx_students_room on students(room_number);

-- ---------------------------------------------------------------------------
-- 3. SETTINGS  (key/value config — deadlines, fine amounts, feature flags)
-- ---------------------------------------------------------------------------
create table if not exists settings (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now()
);

insert into settings (key, value) values
  -- single shared window for BOTH tomorrow's booking and today's
  -- confirmation (see enforce_booking_write() below). confirmation_deadline
  -- is kept only so older data/back-references don't break; it's no longer
  -- read by the app or the trigger.
  ('booking_open_time',            '20:30'),
  ('booking_close_time',           '23:30'),
  ('confirmation_deadline',        '11:59'),
  ('fine_mismatch_amount',         '250'),
  ('fine_no_confirmation_amount',  '100'),
  -- No Food is off by default per meal; admin enables it under
  -- Admin -> Settings -> No Food Option. When enabled for a meal, a
  -- student who booked "yes" may confirm "no_food" with no fine charged
  -- (see recompute_daily_fine()'s mismatch check below).
  ('no_food_enabled_breakfast',    'false'),
  ('no_food_enabled_lunch',        'false'),
  ('no_food_enabled_dinner',       'false'),
  -- Reference-only per-meal rates for the admin Payments screen's
  -- "estimated double-meal cost" column. Deliberately NOT auto-applied to
  -- any student's mess_amount — double meals are tracked as a count for
  -- the admin to factor in manually when setting each month's amount.
  ('meal_rate_breakfast',          '0'),
  ('meal_rate_lunch',              '0'),
  ('meal_rate_dinner',             '0')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- 4. MENU  (weekly recurring menu, by day of week 1=Mon .. 7=Sun)
-- ---------------------------------------------------------------------------
create table if not exists menu (
  id              bigint generated always as identity primary key,
  day_of_week     smallint not null unique check (day_of_week between 1 and 7),
  breakfast_text  text default '',
  lunch_text      text default '',
  dinner_text     text default '',
  image_url       text,
  updated_at      timestamptz not null default now()
);

insert into menu (day_of_week) values (1),(2),(3),(4),(5),(6),(7)
on conflict (day_of_week) do nothing;

-- ---------------------------------------------------------------------------
-- 5. BOOKINGS  (one row per student / date / meal_type)
--    - "booking_status"   = what the student chose the night before (tomorrow)
--    - "confirmed_status" = what the student confirmed on the day itself
-- ---------------------------------------------------------------------------
create table if not exists bookings (
  id                bigint generated always as identity primary key,
  student_id        uuid not null references students(id) on delete cascade,
  date              date not null,
  meal_type         text not null check (meal_type in ('breakfast','lunch','dinner')),

  booking_status    text check (booking_status in ('yes','no','double')),
  booking_locked    boolean not null default false,
  booked_at         timestamptz,

  confirmed_status  text check (confirmed_status in ('yes','no','no_food','double')),
  confirmation_locked boolean not null default false,
  confirmed_at      timestamptz,

  cancelled_by_admin boolean not null default false,

  fine_amount       numeric(10,2) not null default 0,
  remarks           text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  unique (student_id, date, meal_type)
);

create index if not exists idx_bookings_date on bookings(date);
create index if not exists idx_bookings_student on bookings(student_id);
create index if not exists idx_bookings_meal_type on bookings(meal_type);
create index if not exists idx_bookings_student_date on bookings(student_id, date);

-- ---------------------------------------------------------------------------
-- 6. FINES  (audit trail of fine events; bookings.fine_amount is the source
--    of truth for totals, this table records *why* + admin overrides)
-- ---------------------------------------------------------------------------
create table if not exists fines (
  id              bigint generated always as identity primary key,
  student_id      uuid not null references students(id) on delete cascade,
  booking_id      bigint references bookings(id) on delete set null,
  date            date not null,
  amount          numeric(10,2) not null,
  reason          text not null,           -- 'mismatch' | 'no_confirmation' | 'manual'
  is_waived       boolean not null default false,
  overridden_by   uuid references admins(id),
  override_note   text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_fines_student on fines(student_id);
create index if not exists idx_fines_date on fines(date);

-- ---------------------------------------------------------------------------
-- 7. PAYMENTS  (monthly mess bill per student)
-- ---------------------------------------------------------------------------
create table if not exists payments (
  id              bigint generated always as identity primary key,
  student_id      uuid not null references students(id) on delete cascade,
  month_year      date not null,           -- always stored as YYYY-MM-01
  mess_amount     numeric(10,2) not null default 0,
  paid_amount     numeric(10,2) not null default 0,
  status          text not null default 'unpaid' check (status in ('paid','unpaid','partial')),
  payment_date    date,
  method          text,                    -- cash / upi / bank_transfer / other
  transaction_id  text,
  remarks         text,
  updated_at      timestamptz not null default now(),

  unique (student_id, month_year)
);

create index if not exists idx_payments_month on payments(month_year);
create index if not exists idx_payments_status on payments(status);

-- ---------------------------------------------------------------------------
-- 8. EXPENSES
-- ---------------------------------------------------------------------------
create table if not exists expenses (
  id          bigint generated always as identity primary key,
  date        date not null default current_date,
  category    text not null check (category in
                ('grocery','meat','fish','gas','staff_salary','electricity',
                 'water','maintenance','other')),
  amount      numeric(10,2) not null,
  remarks     text,
  bill_url    text,
  created_by  uuid references admins(id),
  created_at  timestamptz not null default now()
);

create index if not exists idx_expenses_date on expenses(date);
create index if not exists idx_expenses_category on expenses(category);

-- ---------------------------------------------------------------------------
-- 9. AUDIT LOGS
-- ---------------------------------------------------------------------------
create table if not exists audit_logs (
  id            bigint generated always as identity primary key,
  admin_id      uuid references admins(id),
  action        text not null,             -- e.g. 'update', 'delete', 'approve'
  table_name    text not null,
  record_id     text,
  old_value     jsonb,
  new_value     jsonb,
  ip            text,
  created_at    timestamptz not null default now()
);

create index if not exists idx_audit_table on audit_logs(table_name, record_id);

-- ============================================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================================

-- keep updated_at fresh
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_students_updated on students;
create trigger trg_students_updated before update on students
  for each row execute function set_updated_at();

drop trigger if exists trg_bookings_updated on bookings;
create trigger trg_bookings_updated before update on bookings
  for each row execute function set_updated_at();

drop trigger if exists trg_payments_updated on payments;
create trigger trg_payments_updated before update on payments
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Guardrail trigger for `bookings` writes coming from a student session.
-- RLS's `bookings_update`/`bookings_insert` policies only decide which ROWS
-- a student may touch (their own); they say nothing about which COLUMNS or
-- VALUES are acceptable. Without this trigger a student could, via a direct
-- API call, unlock an already-locked meal, zero out their own fine, mark a
-- meal cancelled_by_admin, or write bookings for arbitrary dates. This
-- trigger enforces the actual rules at the database layer so the browser
-- UI is a convenience, not the security boundary.
--
-- Admins (and the service-role Edge Functions in supabase/functions/, which
-- run as service_role and therefore have no admins-table row either) both
-- need to bypass these checks — admins for overrides, service-role for the
-- scheduled lock/no-show sweep. is_admin() returns false for service_role
-- (auth.uid() is null under that key), so it's handled as its own case
-- below rather than lumped in with "trust everyone who isn't a plain
-- student", which would defeat the point of the trigger.
-- ---------------------------------------------------------------------------
create or replace function enforce_booking_write()
returns trigger language plpgsql as $$
declare
  v_open time; v_close time; v_now time := current_time;
  v_within_window boolean;
  v_no_food_enabled boolean;
  v_selected_status text;
begin
  -- recompute_daily_fine() runs as the calling student (it's SECURITY
  -- INVOKER, and auth.uid() reflects the request's JWT regardless of
  -- function security context) but needs to write the real fine_amount
  -- onto that student's own rows — which the protected-column rule below
  -- would otherwise silently overwrite back to the old value. It sets this
  -- session-local flag around that one UPDATE statement only.
  if coalesce(current_setting('app.bypass_booking_guard', true), 'false') = 'true' then
    return new;
  end if;

  -- admin overrides (meals.js) are trusted for content, but NOT for which
  -- date they touch: admin per-student overrides must be TODAY only (per
  -- explicit requirement — no editing yesterday's or a future booking).
  -- The one exception is bulk meal cancellation, which legitimately needs
  -- to write tomorrow's date too (cancelling a meal in advance) — that
  -- path always sets cancelled_by_admin = true, so it's distinguished from
  -- a regular per-student override by that flag rather than by date alone.
  if is_admin() then
    if new.date not in (current_date, current_date + 1) then
      raise exception 'Cannot write bookings outside today or tomorrow';
    end if;
    if new.date = current_date + 1 and coalesce(new.cancelled_by_admin, false) is not true then
      raise exception 'Only bulk meal cancellation may write to tomorrow''s date — per-student overrides are today only';
    end if;
    return new;
  end if;

  -- service_role (Edge Function sweeps) has no auth.uid(); trust it too —
  -- it's not reachable from the browser, only from supabase/functions/*
  if auth.uid() is null then
    return new;
  end if;

  -- everything below this line applies only to a genuine student session
  if new.student_id <> auth.uid() then
    raise exception 'Cannot write another student''s booking';
  end if;

  -- protected columns: a student can never set these directly, no matter
  -- what the API call contains
  new.fine_amount := coalesce(old.fine_amount, 0);
  new.cancelled_by_admin := coalesce(old.cancelled_by_admin, false);
  if coalesce(old.cancelled_by_admin, false) then
    raise exception 'This meal was cancelled by the admin and cannot be changed';
  end if;

  if new.date not in (current_date, current_date + 1) then
    raise exception 'Students may only write bookings for today or tomorrow';
  end if;

  -- IMPORTANT: v_now is current_time (the database SERVER's clock, in the
  -- Asia/Kolkata timezone set at the top of this file), never anything
  -- derived from the browser/device. A student changing their phone's
  -- date/time has zero effect on this check — it's evaluated entirely
  -- inside Postgres. See also get_meal_window_status() below, which lets
  -- the client UI *display* the true server-side window state instead of
  -- guessing from the device clock.
  select value::time into v_open from settings where key = 'booking_open_time';
  select value::time into v_close from settings where key = 'booking_close_time';
  v_within_window := case when v_open <= v_close then v_now between v_open and v_close
                          else v_now >= v_open or v_now <= v_close end;

  -- booking_status: only for tomorrow, only inside the shared window, only while unlocked
  if new.booking_status is distinct from old.booking_status then
    if new.date <> current_date + 1 then
      raise exception 'Booking is only accepted for tomorrow''s date';
    end if;
    if coalesce(old.booking_locked, false) then
      raise exception 'Booking is locked and cannot be changed';
    end if;
    if not v_within_window then
      raise exception 'Booking window is closed';
    end if;
    new.booking_locked := false;
    new.booked_at := now();
  end if;

  -- confirmed_status: only for today, only inside the SAME shared window
  -- (booking_open_time–booking_close_time), only while unlocked; locks
  -- immediately on submission (matches spec: "locked and cannot be modified").
  --
  -- ALSO: a student may only write confirmed_status at all when No Food is
  -- enabled for that specific meal. When it's disabled (the default), the
  -- meal is pre-filled from yesterday's booking and is NOT editable by the
  -- student in any way — the nightly lock-confirmations sweep copies
  -- booking_status into confirmed_status automatically for those meals
  -- (see supabase/functions/lock-confirmations), so this never falsely
  -- triggers the "no confirmation submitted" fine.
  if new.confirmed_status is distinct from old.confirmed_status
     or (
       coalesce(new.confirmation_locked, false) is true
       and coalesce(old.confirmation_locked, false) is false
     ) then
    if new.date <> current_date then
      raise exception 'Confirmation is only accepted for today''s date';
    end if;
    if coalesce(old.confirmation_locked, false) then
      raise exception 'Confirmation is locked and cannot be changed';
    end if;
    if not v_within_window then
      raise exception 'Meal selection window is closed';
    end if;
    select value = 'true' into v_no_food_enabled from settings where key = 'no_food_enabled_' || new.meal_type;
    if not coalesce(v_no_food_enabled, false) then
      raise exception 'This meal is locked to your booking — No Food is not enabled for %, so it is not editable', new.meal_type;
    end if;
    v_selected_status := coalesce(old.confirmed_status, new.booking_status, old.booking_status, 'no');
    if new.confirmed_status is null or new.confirmed_status not in (v_selected_status, 'no_food') then
      raise exception 'Only your selected booking option or No Food can be submitted for this meal';
    end if;
    new.confirmation_locked := true;
    new.confirmed_at := now();
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- get_meal_window_status() — lets the client ask "is the window open right
-- now, and what time does the SERVER think it is" instead of computing that
-- from the device's own clock. Every value here comes from Postgres
-- (current_date/current_time in the Asia/Kolkata timezone set above), so
-- changing a phone's date/time has no effect on what this returns — closing
-- the loophole not just at the write-enforcement layer (enforce_booking_write,
-- already server-side) but at the UI layer too, so a tampered device doesn't
-- even see enabled buttons it can't actually use.
-- ---------------------------------------------------------------------------
create or replace function get_meal_window_status()
returns table(server_date date, server_time time, window_open time, window_close time, is_open boolean)
language plpgsql stable as $$
declare
  v_open time; v_close time;
begin
  select value::time into v_open from settings where key = 'booking_open_time';
  select value::time into v_close from settings where key = 'booking_close_time';
  return query select
    current_date,
    current_time::time,
    v_open,
    v_close,
    case when v_open <= v_close then current_time::time between v_open and v_close
         else current_time::time >= v_open or current_time::time <= v_close end;
end;
$$;

grant execute on function get_meal_window_status() to anon, authenticated;

drop trigger if exists trg_bookings_guard on bookings;
create trigger trg_bookings_guard
before insert or update on bookings
for each row execute function enforce_booking_write();

-- ---------------------------------------------------------------------------
-- Fine calculation — recompute fine_amount for a single booking row.
-- Rule recap (exactly two rules, no exceptions):
--   ₹250 once/day  → today's confirmation does not match yesterday's booking
--                    for ANY meal (booking_status vs confirmed_status differ)
--   ₹100 once/day  → the student booked at least one meal (yes/double) but
--                    submitted NO confirmation AT ALL for the day (zero
--                    confirmed meals) once the window has closed
-- "Once per day" is enforced by summing per (student_id, date) across the
-- three meal rows and capping — done in recompute_daily_fine() below, which
-- should be called after any booking/confirmation write for that day.
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: this function is called directly by students (see
-- js/student/confirmation.js) but needs to INSERT/DELETE in `fines` and
-- UPDATE `bookings.fine_amount` — both restricted to admins by RLS. Since
-- this function's own logic is what decides whether a fine applies (a
-- student can't pass it an arbitrary amount, only trigger a recompute of
-- their own already-committed data), running it as the owner is safe and
-- necessary, or a student's confirmation would silently fail to record
-- their own fine.
create or replace function recompute_daily_fine(p_student_id uuid, p_date date)
returns void language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  has_mismatch boolean := false;
  booked_count integer := 0;      -- meals booked yes/double
  confirmed_count integer := 0;   -- meals with ANY confirmed_status set
  any_locked boolean := false;    -- whether the window has closed for this day
  v_mismatch_amt numeric(10,2) := 0;
  v_no_confirm_amt numeric(10,2) := 0;
begin
  -- now that this function bypasses RLS (security definer), explicitly
  -- restrict a real student session to their own student_id. Admin
  -- sessions and service-role Edge Function calls (auth.uid() is null)
  -- may recompute for any student.
  if auth.uid() is not null and not is_admin() and p_student_id <> auth.uid() then
    raise exception 'Cannot recompute fines for another student';
  end if;

  for r in
    select * from bookings where student_id = p_student_id and date = p_date
  loop
    -- mismatch: booked something, confirmed something, and they disagree.
    -- Four combinations count as "no mismatch": Yes/Yes, No/No, Double/Double,
    -- and Yes/No_food (the No Food exception — only meaningful when the
    -- admin has enabled it for that meal, which enforce_booking_write()
    -- already guarantees was true at write time for any no_food row here).
    if r.booking_status is not null and r.confirmed_status is not null then
      if not (
        (r.booking_status = 'yes' and r.confirmed_status = 'yes')
        or (r.booking_status = 'no' and r.confirmed_status = 'no')
        or (r.booking_status = 'double' and r.confirmed_status = 'double')
        or (r.booking_status = 'yes' and r.confirmed_status = 'no_food')
      ) then
        has_mismatch := true;
      end if;
    end if;

    if r.booking_status in ('yes','double') then
      booked_count := booked_count + 1;
    end if;
    if r.confirmed_status is not null then
      confirmed_count := confirmed_count + 1;
    end if;
    if coalesce(r.confirmation_locked, false) then
      any_locked := true;
    end if;
  end loop;

  -- clear previous auto fines for the day, then re-apply
  delete from fines
   where student_id = p_student_id and date = p_date and reason in ('mismatch','no_confirmation');

  if has_mismatch then
    select value::numeric into v_mismatch_amt from settings where key = 'fine_mismatch_amount';
    insert into fines (student_id, date, amount, reason)
    values (p_student_id, p_date, v_mismatch_amt, 'mismatch');
  end if;

  -- whole-day condition: booked at least one meal, confirmed literally
  -- none of them, and the window has closed (so they still have time to
  -- act isn't mistaken for "never confirmed at all")
  if booked_count > 0 and confirmed_count = 0 and any_locked then
    select value::numeric into v_no_confirm_amt from settings where key = 'fine_no_confirmation_amount';
    insert into fines (student_id, date, amount, reason)
    values (p_student_id, p_date, v_no_confirm_amt, 'no_confirmation');
  end if;

  -- Fines are per-day, not per-meal, so bookings.fine_amount (a per-meal-row
  -- column) is kept as a denormalized display copy of that day's total —
  -- the `fines` table above is the source of truth. Student history and
  -- admin reports can read either; this keeps both consistent.
  -- (bypass flag: see enforce_booking_write() — this call is trusted
  -- because it's this function's own deterministic recompute, not an
  -- arbitrary student-supplied value)
  perform set_config('app.bypass_booking_guard', 'true', true);
  update bookings set fine_amount = v_mismatch_amt + v_no_confirm_amt
   where student_id = p_student_id and date = p_date;
  perform set_config('app.bypass_booking_guard', 'false', true);
end;
$$;

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table admins enable row level security;
alter table students enable row level security;
alter table settings enable row level security;
alter table menu enable row level security;
alter table bookings enable row level security;
alter table fines enable row level security;
alter table payments enable row level security;
alter table expenses enable row level security;
alter table audit_logs enable row level security;

-- Helper: is the current auth user an admin?
-- MUST be `security definer` — otherwise this function (running as the
-- calling user) triggers the `admins_select` RLS policy below when it
-- reads the `admins` table, and that policy calls is_admin() again,
-- infinitely recursing until Postgres hits "stack depth limit exceeded".
-- security definer runs it as the function owner instead, who isn't
-- subject to the admins table's own RLS policies (RLS doesn't apply to
-- the table owner unless FORCE ROW LEVEL SECURITY is set, which we don't).
create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from admins where id = auth.uid());
$$;

-- --- admins: only admins can read the admin table (self + peers) ----------
create policy admins_select on admins for select
  using (is_admin());
create policy admins_self_update on admins for update
  using (id = auth.uid());

-- --- students: students read their own row; ONLY admins can write --------
-- IMPORTANT: students must never be able to UPDATE their own row. The
-- `status` column (pending/active/inactive/rejected) is the entire admin
-- approval gate — a student-writable row would let a pending student set
-- their own status to 'active' via a direct API call, skipping approval
-- entirely. The student-facing UI never edits profile fields (see
-- js/student/dashboard.js renderProfile — inputs are disabled with a
-- "contact your admin" note), so this restriction costs no functionality.
create policy students_select_own on students for select
  using (id = auth.uid() or is_admin());
create policy students_admin_update on students for update
  using (is_admin()) with check (is_admin());
create policy students_admin_insert on students for insert
  with check (is_admin());
-- self-registration: a freshly signed-up student may insert exactly one row
-- for their own id, and ONLY with status = 'pending' — they cannot set
-- 'active' themselves. This is what js/auth.js:submitRegistration() uses.
create policy students_self_register on students for insert
  with check (id = auth.uid() and status = 'pending');
create policy students_admin_delete on students for delete
  using (is_admin());

-- --- settings: everyone authenticated can read, only admins write --------
create policy settings_select on settings for select
  using (auth.role() = 'authenticated');
create policy settings_admin_write on settings for insert
  with check (is_admin());
create policy settings_admin_update on settings for update
  using (is_admin());

-- --- menu: everyone reads, only admins write ------------------------------
create policy menu_select on menu for select
  using (auth.role() = 'authenticated');
create policy menu_admin_write on menu for update
  using (is_admin());

-- --- bookings: student sees/writes own rows (subject to lock checks in
--     application layer); admin sees/writes all -----------------------------
create policy bookings_select on bookings for select
  using (student_id = auth.uid() or is_admin());
create policy bookings_insert on bookings for insert
  with check (student_id = auth.uid() or is_admin());
create policy bookings_update on bookings for update
  using (student_id = auth.uid() or is_admin());
create policy bookings_admin_delete on bookings for delete
  using (is_admin());

-- --- fines: student reads own, admin reads/writes all ---------------------
create policy fines_select on fines for select
  using (student_id = auth.uid() or is_admin());
create policy fines_admin_write on fines for insert
  with check (is_admin());
create policy fines_admin_update on fines for update
  using (is_admin());

-- --- payments: student reads own, admin full access -----------------------
create policy payments_select on payments for select
  using (student_id = auth.uid() or is_admin());
create policy payments_admin_write on payments for insert
  with check (is_admin());
create policy payments_admin_update on payments for update
  using (is_admin());

-- --- expenses: admin only --------------------------------------------------
create policy expenses_admin_all on expenses for all
  using (is_admin()) with check (is_admin());

-- --- audit_logs: admin only -------------------------------------------------
create policy audit_admin_all on audit_logs for all
  using (is_admin()) with check (is_admin());

-- ---------------------------------------------------------------------------
-- Defense in depth: explicitly strip the `anon` role's table grants.
-- RLS policies above already restrict every table to authenticated users
-- (students/admins), but Supabase's default schema grants give `anon` and
-- `authenticated` broad table privileges out of the box, relying on RLS
-- alone to filter rows. Revoking `anon` table access here means a future
-- policy mistake (e.g. an overly-permissive `using (true)`) can't
-- accidentally expose data to logged-out requests — there's no grant for
-- it to exploit in the first place. `authenticated` keeps normal grants;
-- RLS policies above still govern which rows/columns each role can touch.
-- ---------------------------------------------------------------------------
revoke all on admins, students, settings, menu, bookings, fines, payments, expenses, audit_logs
  from anon;

-- ============================================================================
-- END OF SCHEMA
-- ============================================================================
