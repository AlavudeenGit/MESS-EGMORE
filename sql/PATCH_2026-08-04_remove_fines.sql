-- ============================================================================
-- PATCH — removes fine calculation entirely. recompute_daily_fine() becomes
-- a genuine no-op; the trigger is otherwise unchanged (this patch is really
-- just here to replace recompute_daily_fine cleanly). The `fines` table and
-- any historical rows in it are left untouched — see
-- sql/OPTIONAL_drop_fines_table.sql if you want those fully removed too,
-- but that's optional and NOT reversible.
-- Run this whole block in the SQL Editor. Safe to re-run.
-- ============================================================================

-- remove the fine-amount settings rows (harmless if they don't exist)
delete from settings where key in ('fine_mismatch_amount', 'fine_no_confirmation_amount');

-- Fine calculation has been REMOVED from this app entirely — no fine is
-- ever charged for a mismatch, a missing confirmation, or anything else.
-- Nothing in js/, supabase/functions/, or this schema calls this function
-- anymore. It's kept as an inert no-op (rather than dropped outright) only
-- so a stale cached client build that still tries to call the RPC gets a
-- harmless success response instead of a hard error. The `fines` table
-- above is likewise untouched by anything now — see the note on it.
-- Safe to drop both later if you're confident nothing references them.
-- ---------------------------------------------------------------------------
create or replace function recompute_daily_fine(p_student_id uuid, p_date date)
returns void language plpgsql
security definer
set search_path = public
as $$
begin
  -- intentionally does nothing
end;
$$;

