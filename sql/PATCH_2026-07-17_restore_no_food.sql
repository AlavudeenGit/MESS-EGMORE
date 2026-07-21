-- ============================================================================
-- PATCH — restores "No Food" support (settings + trigger + fine logic),
-- which a prior edit had stripped out. Safe to re-run.
-- Run this whole block in the SQL Editor.
-- ============================================================================

-- 1. Restore the per-meal No Food toggles (default OFF — enable under
--    Admin -> Settings -> No Food Option once this patch is applied)
insert into settings (key, value) values
  ('no_food_enabled_breakfast', 'false'),
  ('no_food_enabled_lunch', 'false'),
  ('no_food_enabled_dinner', 'false')
on conflict (key) do nothing;

-- 2. Replace the trigger: allow confirmed_status = 'no_food' when enabled
--    for that meal, instead of unconditionally rejecting it
create or replace function enforce_booking_write()
returns trigger language plpgsql as $$
declare
  v_open time; v_close time; v_now time := current_time;
  v_within_window boolean;
  v_no_food_enabled boolean;
begin
  if coalesce(current_setting('app.bypass_booking_guard', true), 'false') = 'true' then
    return new;
  end if;

  if is_admin() then
    if new.date not in (current_date, current_date + 1) then
      raise exception 'Cannot write bookings outside today or tomorrow';
    end if;
    if new.date = current_date + 1 and coalesce(new.cancelled_by_admin, false) is not true then
      raise exception 'Only bulk meal cancellation may write to tomorrow''s date — per-student overrides are today only';
    end if;
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if new.student_id <> auth.uid() then
    raise exception 'Cannot write another student''s booking';
  end if;

  -- No Food is only valid when the admin has enabled it for that meal
  if new.confirmed_status = 'no_food' then
    select value = 'true' into v_no_food_enabled from settings where key = 'no_food_enabled_' || new.meal_type;
    if not coalesce(v_no_food_enabled, false) then
      raise exception 'No Food is not enabled for %', new.meal_type;
    end if;
  end if;

  new.fine_amount := coalesce(old.fine_amount, 0);
  new.cancelled_by_admin := coalesce(old.cancelled_by_admin, false);
  if coalesce(old.cancelled_by_admin, false) then
    raise exception 'This meal was cancelled by the admin and cannot be changed';
  end if;

  if new.date not in (current_date, current_date + 1) then
    raise exception 'Students may only write bookings for today or tomorrow';
  end if;

  select value::time into v_open from settings where key = 'booking_open_time';
  select value::time into v_close from settings where key = 'booking_close_time';
  v_within_window := case when v_open <= v_close then v_now between v_open and v_close
                          else v_now >= v_open or v_now <= v_close end;

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

  if new.confirmed_status is distinct from old.confirmed_status then
    if new.date <> current_date then
      raise exception 'Confirmation is only accepted for today''s date';
    end if;
    if coalesce(old.confirmation_locked, false) then
      raise exception 'Confirmation is locked and cannot be changed';
    end if;
    if not v_within_window then
      raise exception 'Meal selection window is closed';
    end if;
    new.confirmation_locked := true;
    new.confirmed_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists trg_bookings_guard on bookings;
create trigger trg_bookings_guard
before insert or update on bookings
for each row execute function enforce_booking_write();

-- 3. Replace recompute_daily_fine: restore the No Food exception in the
--    mismatch check (booked Yes + confirmed No Food = not a mismatch)
create or replace function recompute_daily_fine(p_student_id uuid, p_date date)
returns void language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  has_mismatch boolean := false;
  booked_count integer := 0;
  confirmed_count integer := 0;
  any_locked boolean := false;
  v_mismatch_amt numeric(10,2) := 0;
  v_no_confirm_amt numeric(10,2) := 0;
begin
  if auth.uid() is not null and not is_admin() and p_student_id <> auth.uid() then
    raise exception 'Cannot recompute fines for another student';
  end if;

  for r in
    select * from bookings where student_id = p_student_id and date = p_date
  loop
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

  delete from fines
   where student_id = p_student_id and date = p_date and reason in ('mismatch','no_confirmation');

  if has_mismatch then
    select value::numeric into v_mismatch_amt from settings where key = 'fine_mismatch_amount';
    insert into fines (student_id, date, amount, reason)
    values (p_student_id, p_date, v_mismatch_amt, 'mismatch');
  end if;

  if booked_count > 0 and confirmed_count = 0 and any_locked then
    select value::numeric into v_no_confirm_amt from settings where key = 'fine_no_confirmation_amount';
    insert into fines (student_id, date, amount, reason)
    values (p_student_id, p_date, v_no_confirm_amt, 'no_confirmation');
  end if;

  perform set_config('app.bypass_booking_guard', 'true', true);
  update bookings set fine_amount = v_mismatch_amt + v_no_confirm_amt
   where student_id = p_student_id and date = p_date;
  perform set_config('app.bypass_booking_guard', 'false', true);
end;
$$;
