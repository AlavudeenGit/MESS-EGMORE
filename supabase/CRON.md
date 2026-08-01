# Edge Functions — deploy + schedule

Four functions live in `supabase/functions/`:

| Function               | Trigger                                                         | Purpose                                                                                                           |
| ---------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `lock-bookings`        | daily cron, ~5 min after `booking_close_time`                   | locks tomorrow's bookings, defaults no-shows to "No"                                                              |
| `lock-confirmations`   | daily cron, **same time** as `lock-bookings`                    | locks today's confirmations, auto-copies the booking into confirmed_status for any meal where No Food is disabled |
| `admin-create-student` | called from the browser (Admin → Students → Add Student)        | creates a login + student row using the service role key                                                          |
| `admin-delete-student` | called from the browser (Admin → Students → Delete)             | permanently deletes a student's auth login, which cascades to their students/bookings/payments rows               |
| `student-register`     | called from the browser (the registration form on `index.html`) | creates the auth login + students row atomically, rolling back the login if the students insert fails             |

Booking and confirmation now share one evening window (default 8:30–11:30
PM, editable under Admin → Settings), so both sweep functions run on the
same schedule — there's no separate morning deadline anymore.

## 1. Deploy

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF

supabase functions deploy lock-bookings
supabase functions deploy lock-confirmations
supabase functions deploy admin-create-student
supabase functions deploy admin-delete-student
supabase functions deploy student-register
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
`settings.booking_close_time`, and swap in your project ref +
`CRON_SECRET`). Both functions now run at the same time since booking and
confirmation share one window:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- both run ~5 minutes after booking_close_time (default 11:30 PM IST ->
-- 18:00 UTC -> schedule at 18:05 UTC; pg_cron runs in UTC, so subtract
-- 5:30 from your IST close time to get the UTC hour)
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

select cron.schedule(
  'lock-confirmations-daily',
  '5 18 * * *',  -- same time as lock-bookings — same shared window now
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

**If you change the window in Admin → Settings later**, update both cron
schedule times to match — they're not read dynamically from `settings`,
since pg_cron schedules are static.

## 4. Test manually before relying on the schedule

```bash
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/lock-bookings?secret=YOUR_CRON_SECRET"
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/lock-confirmations?secret=YOUR_CRON_SECRET"
```

Both return JSON like `{"ok":true,"date":"2026-07-16","locked":12,"defaulted":3}`
(`lock-confirmations` also returns `"autoConfirmed"`, the number of
untouchable-meal rows it copied the booking into for the day).
