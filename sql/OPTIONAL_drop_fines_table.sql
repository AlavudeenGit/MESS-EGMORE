-- ============================================================================
-- OPTIONAL — fully removes the fines table and recompute_daily_fine()
-- function, instead of leaving them in place-but-inert (which is what
-- sql/schema.sql now does by default). Run this ONLY if you're sure you
-- don't need any historical fine data that might already be in the table —
-- this is NOT reversible.
--
-- You do not need to run this for fine calculation to stop — that's
-- already handled by schema.sql (recompute_daily_fine is a no-op, and
-- nothing in the app calls it or writes to `fines` anymore). This script
-- is purely for cleaning up the now-unused table/function/policies if
-- you'd rather they not exist in the database at all.
-- ============================================================================

drop policy if exists fines_select on fines;
drop policy if exists fines_admin_write on fines;
drop policy if exists fines_admin_update on fines;

drop function if exists recompute_daily_fine(uuid, date);

drop table if exists fines;

-- bookings.fine_amount is left in place (it's just a plain numeric column,
-- not a foreign key or anything fines-table-specific) since dropping a
-- column is a bigger, harder-to-reverse schema change. If you want it gone
-- too:
-- alter table bookings drop column fine_amount;
