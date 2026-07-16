-- ============================================================================
-- PATCH — bug-fix round: unified 8:30 PM–11:30 PM window for both booking
-- and confirmation (replaces the separate morning confirmation deadline).
-- Run this whole block in the SQL Editor. Safe to re-run.
-- ============================================================================

-- 1. Update the shared window default (skip/edit if you already customized these)
update settings set value = '20:30' where key = 'booking_open_time';
update settings set value = '23:30' where key = 'booking_close_time';

-- 2. Replace the trigger function to use the shared window for BOTH
--    booking_status and confirmed_status changes (previously confirmed_status
--    used a separate `confirmation_deadline` setting).
create or replace function enforce_booking_write()
returns trigger language plpgsql as $$
declare
  v_open time; v_close time; v_now time := current_time;
  v_no_food_enabled boolean;
  v_within_window boolean;
begin
  if coalesce(current_setting('app.bypass_booking_guard', true), 'false') = 'true' then
    return new;
  end if;

  if is_admin() then
    return new;
  end if;

  if auth.uid() is null then
    return new;
  end if;

  if new.student_id <> auth.uid() then
    raise exception 'Cannot write another student''s booking';
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
    if new.confirmed_status = 'no_food' then
      select value = 'true' into v_no_food_enabled from settings where key = 'no_food_enabled_' || new.meal_type;
      if not coalesce(v_no_food_enabled, false) then
        raise exception 'No Food is not enabled for %', new.meal_type;
      end if;
    end if;
    new.confirmation_locked := true;
    new.confirmed_at := now();
  end if;

  return new;
end;
$$;

-- 3. Re-point the trigger at the replaced function (create or replace above
--    already updates the function body in place, but re-running this is
--    harmless and makes the intent explicit)
drop trigger if exists trg_bookings_guard on bookings;
create trigger trg_bookings_guard
before insert or update on bookings
for each row execute function enforce_booking_write();
