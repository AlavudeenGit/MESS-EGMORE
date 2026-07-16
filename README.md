# Sunrise Mess — Meal Booking System

Mobile-first Mess Meal Booking System. Vanilla JS (ES modules) + Supabase
(Postgres, Auth, Realtime). No build step — deploy the folder as-is.

## What's built

- **Database** — `sql/schema.sql`: all tables, indexes, constraints, the
  `recompute_daily_fine()` fine-calculation function, and full Row Level
  Security policies.
- **Auth** — email/password, self-registration (admin shares the link),
  admin approval workflow. No OTP/email verification, per spec.
- **Student app** — `index.html` → `student-dashboard.html`
  (`js/student/*`): dashboard with the "thali ring" status widget, Mark
  Food (today's confirmation + tomorrow's booking, tabbed), read-only
  weekly menu, filterable/exportable history.
- **Admin app** — `admin-dashboard.html` (`js/admin/*`): overview with
  charts, student management (including direct student creation via the
  `admin-create-student` edge function), registration approvals, meal
  overrides + bulk cancellation, weekly menu editor, expenses, payments
  (with a reference-only Double Meal count + estimated cost column — see
  below), a generic report builder covering all 11 report types in the
  spec, and a **Settings** page to edit deadlines, fine amounts, No Food
  toggles, and per-meal rates without touching SQL.
- **Design system** — `css/main.css` + `css/student.css` + `css/admin.css`
  - `css/dark-mode.css`. Palette and the thali-ring signature widget are
    described inline as CSS comments.

## 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** → paste the contents of `sql/schema.sql` → run.
3. Open **Project Settings → API** and copy the **Project URL** and
   **anon public key**.
4. Paste them into `js/config.js`:
   ```js
   const SUPABASE_URL = "https://YOUR-PROJECT.supabase.co";
   const SUPABASE_ANON_KEY = "YOUR-ANON-KEY";
   ```

### Turn off email confirmation (important)

By default Supabase Auth emails a "confirm your address" link on sign-up
and blocks login until it's clicked. This app doesn't want that — email
is just a username, and the approval gate is the admin, not an email
click. Turn it off:

**Authentication → Providers → Email → toggle "Confirm email" OFF** (save).

With this off, `auth.signUp()` returns an active, immediately-loginable
auth user. The student still can't actually log in yet, though, because
`requireRole()`/`login()` in this app separately check `students.status
= 'active'` — so the admin approval step is still the real gate. This
setting only removes the _extra_ email-click step Supabase would
otherwise add on top of it.

### Create the first admin account

The app has no public "become an admin" flow (by design). Create the
first admin manually:

1. In Supabase, go to **Authentication → Users → Add User** and create
   an account with the admin's email/password.
2. In **SQL Editor**, run:
   ```sql
   insert into admins (id, name, mobile)
   values ('<the-user-uuid-from-step-1>', 'Admin Name', '9999999999');
   ```
3. Log in at `index.html` with that email/password — you'll land on
   `admin-dashboard.html`.

### Share the student registration link

Send students `index.html` (they tap the **Register** tab). Submissions
land in **Admin → Registrations** as `pending` until approved.

## 2. Edge Functions (deadline lock, fine sweep, admin-created logins)

Three Supabase Edge Functions live in `supabase/functions/` and handle
everything that needs the service role key or a server-side clock:

- **`lock-bookings`** — locks tomorrow's bookings after `booking_close_time`.
- **`lock-confirmations`** — locks today's confirmations after
  `confirmation_deadline`, then runs `recompute_daily_fine()` for every
  active student so fines are finalized for the day.
- **`admin-create-student`** — lets an admin add a student with login
  credentials directly from Admin → Students (self-registration still
  works too, and still needs approval; this is the fast path).

Full deploy + `pg_cron` scheduling instructions: **`supabase/CRON.md`**.

## 4. Deploy

Static hosting — no build step:

- **Vercel**: `vercel deploy` from this folder (or connect the repo).
- **Netlify**: drag-and-drop the folder in the Netlify dashboard, or
  `netlify deploy`.

Either way, just make sure `js/config.js` has your real Supabase URL/key
before deploying.

## Folder structure

```
/
├── index.html                 (login + registration)
├── student-dashboard.html     (student SPA shell)
├── admin-dashboard.html       (admin SPA shell)
├── css/
│   ├── main.css                design tokens + shared components
│   ├── student.css
│   ├── admin.css
│   └── dark-mode.css
├── js/
│   ├── config.js               Supabase client + constants
│   ├── auth.js
│   ├── utils.js                dates, settings cache, exports, session guard
│   ├── student/
│   │   ├── dashboard.js        router + home + profile
│   │   ├── booking.js          tomorrow's booking + "Mark Food" tabs
│   │   ├── confirmation.js     today's confirmation
│   │   ├── menu.js             read-only weekly menu
│   │   └── history.js
│   ├── admin/
│   │   ├── dashboard.js        router + home overview + charts
│   │   ├── students.js
│   │   ├── registrations.js
│   │   ├── meals.js            overrides + bulk cancellation
│   │   ├── menu.js
│   │   ├── expenses.js
│   │   ├── payments.js
│   │   └── reports.js          generic builder for all 11 report types
│   └── components/
│       ├── Toast.js
│       ├── Modal.js
│       ├── Card.js             stat cards + "thali ring" signature widget
│       └── Table.js
└── sql/
    └── schema.sql
```

## Fine rules (as implemented in `recompute_daily_fine`)

- **₹250/day** — any mismatch between booking and confirmation for the
  day (capped at one ₹250 fine per day regardless of how many of the
  three meals mismatch).
- **₹100/day** — booked "Yes"/"Double" but never confirmed at all,
  detected once `confirmation_locked = true` (see the deadline sweep
  above).
- **No Food exception** — booked "Yes", confirmed "No Food" (when the
  admin has enabled No Food for that meal) → no fine.

Both amounts are read from the `settings` table
(`fine_mismatch_amount`, `fine_no_confirmation_amount`), editable by an
admin without a code change — see the **Settings** page in the admin app.

## Double meals — reference only, never auto-charged

Per your call: a "Double" meal is tracked as a count, not an automatic
charge. Admin → Payments shows each student's double-meal count for the
selected month and an **estimated** cost (`count × meal_rate_<meal>`,
configured under Admin → Settings), clearly labeled "reference only."
That number is never written into `mess_amount` — the admin still types
in whatever they actually want to charge. If you'd rather it auto-add to
the mess amount later, that's a small change to `admin/payments.js`
(compute `estCost` into the default `amount` input value instead of only
displaying it) — flagging it here since it's the kind of thing easy to
want changed once you see it in practice.

## Security notes from the RLS review

A few gaps were closed after the first pass — worth knowing about if you
extend the schema:

- **Students can no longer `UPDATE` their own `students` row at all.**
  Originally they could, which meant a pending student could set their
  own `status = 'active'` directly via the API and skip admin approval
  entirely. Now only admins can write to `students`; a narrow
  `students_self_register` insert policy still lets a brand-new sign-up
  create their own row, but only with `status = 'pending'` forced by the
  policy's `with check`.
- **A `trg_bookings_guard` trigger enforces the real booking/confirmation
  rules at the database layer**, not just in the browser. Without it, a
  student could call the API directly to unlock an already-locked meal,
  zero out their own fine, mark a meal `cancelled_by_admin`, or write
  bookings for arbitrary dates — RLS alone only decides _which rows_ a
  student can touch, not _which columns or values_. The trigger checks
  deadlines, lock state, and protects `fine_amount`/`cancelled_by_admin`
  from student writes, while still letting admin overrides (`is_admin()`)
  and the service-role Edge Function sweeps bypass it.
- **`bookings.fine_amount` is fixed to actually reflect the computed
  fine.** It was previously reset to 0 every time `recompute_daily_fine()`
  ran and never set to anything else — `js/student/history.js` would have
  shown ₹0 even when a student was genuinely fined. Fines are a per-day
  concept (not per-meal), so `fine_amount` is now a denormalized copy of
  that day's total, written back with a narrow session-scoped bypass so
  the new guard trigger doesn't immediately undo it; the `fines` table
  remains the source of truth.
- **Database timezone set to `Asia/Kolkata`.** Every deadline/date check
  (`current_date`, `current_time`) needs to mean India time; Postgres
  defaults to UTC, which would have silently shifted every deadline by
  5.5 hours. `sql/schema.sql` sets this on the database at the top of the
  script.
- **`anon` role's table grants are explicitly revoked** as defense in
  depth, so a future overly-permissive policy can't accidentally expose
  data to logged-out requests.

## Bug-fix round — student flow, admin meals table, mobile nav, reports UI

**Student "Mark Food" — select then submit, shared time window.**
Tapping a meal option used to call the API immediately. Now it only
updates local selection state (highlights the button); nothing is saved
until the new **Submit** button is tapped, which sends everything
changed in one batch call. Both selecting _and_ submitting are gated to
one shared window — default **8:30 PM–11:30 PM** — that now covers both
tabs (today's confirmation and tomorrow's booking use the same window,
replacing the old separate morning confirmation deadline). Outside the
window every option is disabled and Submit is hidden. Configurable under
Admin → Settings → Meal Selection Window; the DB trigger
(`enforce_booking_write` in `sql/schema.sql`) enforces the same window
server-side, not just in the UI.

**Admin → Meal Entries now shows one row per student.** Breakfast, Lunch,
and Dinner appear as three columns in the same row (each showing its
Booked/Confirmed badges), instead of three separate rows per student.
The Edit button opens one modal covering all three meals at once.

**Admin mobile nav.** With 9 side-nav items + Logout, the old 5-icon
bottom bar couldn't fit everything (Registrations, Weekly Menu, Expenses,
Settings, and Logout were unreachable on a phone). The bottom nav now
shows the 4 most-used items (Home, Meals, Payments, Reports) plus a
**More** button that opens a drawer with everything else, Logout
included.

**Reports page dropdown rendering.** The Report Type `<select>` looked
collapsed/garbled — its floating label and the selected value text were
overlapping. Root cause: the floating-label CSS only floats the label on
`:focus` or a manually-toggled `.has-value` class, which text inputs get
automatically (`:not(:placeholder-shown)`) but `<select>` elements don't
support that pseudo-class at all. Fixed by always floating `<select>`
labels in `css/main.css`, since a dropdown always shows a value and never
has a true empty/placeholder state the way a text field does. This fixes
every select in the app (Report Type, expense category, settings toggles),
not just the one that was reported.

## Not yet wired up (clearly-scoped follow-ups)

- Image/bill uploads for expenses (`expenses.bill_url` column exists;
  hook up Supabase Storage when needed).
- Audit log writes (`audit_logs` table exists with RLS; not yet called
  from the admin UI actions — straightforward to add per action).
