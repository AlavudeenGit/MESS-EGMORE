# Edge Functions — deploy + schedule

Three functions live in `supabase/functions/`:

| Function | Trigger | Purpose |
|---|---|---|
| `lock-bookings` | daily cron, ~5 min after `booking_close_time` | locks tomorrow's bookings, defaults no-shows to "No" |
| `lock-confirmations` | daily cron, ~5 min after `confirmation_deadline` | locks today's confirmations, runs the fine sweep |
| `admin-create-student` | called from the browser (Admin → Students → Add Student) | creates a login + student row using the service role key |

## 1. Deploy

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

supabase functions deploy lock-bookings
supabase functions deploy lock-confirmations
supabase functions deploy admin-create-student
```

## 2. Set secrets

`admin-create-student` needs the service role key (never put this in
`js/config.js` — it belongs only here, server-side):

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
supabase secrets set SUPABASE_URL=https://YOUR-PROJECT.supabase.co
supabase secrets set SUPABASE_ANON_KEY=your-anon-key

# optional but recommended: a shared secret so lock-bookings/lock-confirmations
# can't be triggered by anyone who finds the URL
supabase secrets set CRON_SECRET=some-long-random-string
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are auto-injected into every
Edge Function by Supabase, but `SUPABASE_ANON_KEY` (needed by
`admin-create-student` to verify the caller's session) is not — set it
explicitly as shown above.

## 3. Schedule the two sweep functions with pg_cron

Run this in the SQL Editor (adjust the times to match your
`settings.booking_close_time` / `settings.confirmation_deadline`, and swap
in your project ref + `CRON_SECRET`):

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- lock-bookings: 5 minutes after booking_close_time (23:30 -> 23:35 UTC+5:30
-- means 18:05 UTC — pg_cron runs in UTC, convert your local time accordingly)
select cron.schedule(
  'lock-bookings-daily',
  '5 18 * * *',  -- adjust to (booking_close_time - 5:30 IST offset) + 5 min
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/lock-bookings?secret=YOUR_CRON_SECRET',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);

-- lock-confirmations: 5 minutes after confirmation_deadline (11:59 IST -> ~06:34 UTC)
select cron.schedule(
  'lock-confirmations-daily',
  '35 6 * * *',  -- adjust to (confirmation_deadline - 5:30 IST offset) + 5 min
  $$
  select net.http_post(
    url := 'https://YOUR_PROJECT_REF.supabase.co/functions/v1/lock-confirmations?secret=YOUR_CRON_SECRET',
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  $$
);
```

Check scheduled jobs any time with `select * from cron.job;`, and recent
runs with `select * from cron.job_run_details order by start_time desc
limit 10;`.

**If you change `booking_close_time` or `confirmation_deadline` in the
Settings table later**, update the cron schedule times to match —
they're not read dynamically from `settings`, since pg_cron schedules are
static. (A more advanced version could run every 5 minutes and check
`settings` itself before acting, at the cost of more invocations — not
needed for a single mess.)

## 4. Test manually before relying on the schedule

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/lock-bookings?secret=YOUR_CRON_SECRET"
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/lock-confirmations?secret=YOUR_CRON_SECRET"
```

Both return JSON like `{"ok":true,"date":"2026-07-16","locked":12,"defaulted":3}`
(`lock-confirmations` also returns `"recomputed"`, the number of students
whose fines were finalized for the day).
