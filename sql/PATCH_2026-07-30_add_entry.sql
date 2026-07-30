-- ============================================================================
-- PATCH — allows admin writes to YESTERDAY's date for the new "Add Entry"
-- feature on Meal Entries. A fresh row (INSERT) is always fine; an UPDATE
-- to yesterday's date is allowed too, but ONLY when the existing row isn't
-- a "real" entry yet (no meal marked Yes/Double) — the nightly sweep
-- auto-fills every untouched meal to "No" every night, so almost every
-- student already has a row for yesterday, and Add Entry's upsert needs to
-- be able to overwrite that auto-filled placeholder. A genuinely
-- already-marked yesterday entry still can't be overwritten this way.
-- Run this whole block in the SQL Editor. Safe to re-run.
-- ============================================================================

create or replace function enforce_booking_write()
returns trigger language plpgsql as $$
declare
  v_open time; v_close time; v_now time := current_time;
  v_within_window boolean;
  v_no_food_enabled boolean;
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
  -- date they touch:
  --   - today: always allowed (per-student override / Add Entry)
  --   - tomorrow: ONLY the bulk-cancel path (cancelled_by_admin = true)
  --   - yesterday: a brand-new row (TG_OP = 'INSERT') is always fine, and
  --     an UPDATE is allowed too but ONLY when the existing row isn't a
  --     "real" entry yet (no meal marked Yes/Double) — the nightly
  --     lock-bookings/lock-confirmations sweep auto-fills every untouched
  --     meal to "No" every night, so almost every student already has a
  --     row for yesterday; without this, Add Entry's upsert would hit that
  --     auto-filled row and get rejected for being an UPDATE, defeating
  --     the whole feature. This mirrors the exact "already marked" check
  --     Add Entry's Student dropdown uses client-side, so a genuinely
  --     already-marked yesterday entry still can't be silently overwritten.
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
    if new.date = current_date - 1 then
      if TG_OP = 'INSERT' then
        return new;
      end if;
      if TG_OP = 'UPDATE'
         and coalesce(old.booking_status, '') not in ('yes', 'double')
         and coalesce(old.confirmed_status, '') not in ('yes', 'double') then
        return new;
      end if;
      raise exception 'This student already has a real entry for yesterday and it cannot be overwritten here';
    end if;
    raise exception 'Admin writes are only allowed for yesterday, today, or tomorrow (bulk cancellation only)';
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