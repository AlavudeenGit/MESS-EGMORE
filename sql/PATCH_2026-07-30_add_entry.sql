-- ============================================================================
-- PATCH — allows admin writes to YESTERDAY's date, but only brand-new rows
-- (never an update of an existing row) — this is what the new "Add Entry"
-- feature on Meal Entries needs, to backfill a student who has zero
-- entries for today or yesterday. Run this whole block in the SQL Editor.
-- Safe to re-run.
-- ============================================================================

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

  -- admin overrides (meals.js) are trusted for content, but NOT for which
  -- date they touch:
  --   - today: always allowed (per-student override / Add Entry)
  --   - tomorrow: ONLY the bulk-cancel path (cancelled_by_admin = true)
  --   - yesterday: ONLY a brand-new row (TG_OP = 'INSERT') — this is what
  --     "Add Entry" needs (backfilling a student who has zero entries for
  --     yesterday), but explicitly does NOT allow overwriting an existing
  --     yesterday row via UPDATE, since that stays out of scope on purpose.
  if is_admin() then
    if new.date = current_date + 1 then
      if coalesce(new.cancelled_by_admin, false) is not true then
        raise exception 'Only bulk meal cancellation may write to tomorrow''s date — per-student overrides are today only';
      end if;
      return new;
    end if;
    if new.date = current_date then
      return new;
    end if;
    if new.date = current_date - 1 and TG_OP = 'INSERT' then
      return new;
    end if;
    raise exception 'Admin writes are only allowed for yesterday (new entries only), today, or tomorrow (bulk cancellation only)';
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
    select value = 'true' into v_no_food_enabled from settings where key = 'no_food_enabled_' || new.meal_type;
    if not coalesce(v_no_food_enabled, false) then
      raise exception 'This meal is locked to your booking — No Food is not enabled for %, so it is not editable', new.meal_type;
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
