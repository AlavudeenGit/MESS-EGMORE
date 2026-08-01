# Finding and clearing orphaned auth logins

Before the `student-register` Edge Function existed, a failed registration
(auth login created, but the `students` row insert failed for any reason)
left the auth login behind with nothing pointing to it — invisible in
Students or Registrations, but the email stays permanently locked in
Supabase Auth. If someone reports "already registered" for an email you've
never approved or rejected, this is almost certainly why.

## 1. Find them

Run this in the SQL Editor — it's read-only, safe to run anytime:

```sql
select u.id, u.email, u.created_at
from auth.users u
left join students s on s.id = u.id
left join admins a on a.id = u.id
where s.id is null and a.id is null
order by u.created_at desc;
```

Anything this returns is an orphan: an auth login with no matching
`students` row and no matching `admins` row.

## 2. Clear them

Don't `DELETE FROM auth.users` directly in SQL — Supabase's Auth schema
has several related internal tables (sessions, identities, refresh
tokens) that the Admin API keeps consistent for you; a raw SQL delete
can leave some of those behind.

Instead, for each orphaned email from step 1:

- **Dashboard** (simplest, no setup needed): Authentication → Users →
  search the email → the "..." menu → Delete user.
- **Or via the Admin REST API directly**, if you have several to clear
  and want to script it (needs your service role key — run this from
  your own machine, never from the browser):
  ```bash
  curl -X DELETE \
    "https://YOUR_PROJECT_REF.supabase.co/auth/v1/admin/users/USER_ID_FROM_STEP_1" \
    -H "apikey: YOUR_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY"
  ```

Once deleted, that email is immediately free to register again.

## Going forward

This shouldn't happen anymore — `student-register` (see
`supabase/functions/student-register/index.ts`) now does the whole
registration atomically server-side and rolls back the auth login it
creates if the `students` insert fails for any reason. Make sure it's
deployed:

```bash
supabase functions deploy student-register
```
