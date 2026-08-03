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

## Fine calculation — removed

There used to be a ₹250 mismatch fine and a ₹100 no-confirmation fine
here. Both were removed entirely — see the "Fine calculation removed
entirely" changelog entry further down for exactly what changed and
why. No fine is calculated anywhere in the app anymore.

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

## Bug-fix round — No Food restored, reports.js rewritten, real Delete

**No Food was fully restored.** A prior edit had stripped it out end to
end (settings, the DB trigger, `confirmation.js`, the admin override
modal, and the Settings page) — but it's a required rule (booked Yes +
confirmed No Food, when enabled for that meal, carries no fine), so it's
back in all of those places. If your database was already updated with
the No Food removal, run the SQL patch mentioned below to bring it back.

**`reports.js` had a real bug: a missing template-literal backtick.**
`root.innerHTML = ...` was missing its opening backtick, so the raw HTML
after it was silently swallowed into an unterminated string (which,
oddly, didn't throw a syntax error — it just meant the Reports page was
broken). Two referenced-but-undefined functions (`attendanceColumns`,
`fetchAttendance`) and an undefined `REPORT_HINTS` would have crashed the
page the moment anyone opened Reports. Rewrote the file cleanly, and
while doing so:

- Added the **Daily Attendance Report** — students who submitted a
  confirmation on the selected date, columns Name/Room/Breakfast/
  Lunch/Dinner. Report type now shows a single date picker instead of
  month/from/to when Daily Attendance is selected.
- Added **Breakfast Count / Lunch Count / Dinner Count** columns to the
  Student Report — confirmed yes/double counts for whatever date filter
  (month or from/to range) is currently set.

**Fine logic — confirmed no-double-penalty behavior.** The mismatch
(₹250) and no-confirmation (₹100) conditions are mutually exclusive by
construction: a mismatch requires an actual confirmed value to compare
against, while no-confirmation requires zero confirmed values that day —
so both can never be true simultaneously, and a day's fine is always
₹250, ₹100, or ₹0, never ₹350.

**Admin → Meal Entries and per-student overrides were already
restricted to today only** (both in the UI and enforced again in the DB
trigger) — verified this round, no change needed.

**Delete now really deletes.** Added `admin-delete-student` (new Edge
Function — deploy it per `supabase/CRON.md`). It deletes the student's
auth login via the service role key, which cascades to remove their
`students`/`bookings`/`fines`/`payments` rows entirely. Deactivate is
unchanged — it still just flips `status` to `inactive` and keeps
everything.

## Dashboard/Reports/Meal-Entries restructure + locked Today's Confirmation

**Dashboard** — removed the "Meal Booking Trend (7 days)" and "Expense
Breakdown (this month)" charts (and the now-unused Chart.js include).
Everything else — summary cards, activity feed — unchanged.

**Reports reduced to 6 types**: Students Report (with Breakfast/Lunch/
Dinner totals for the current month), Daily Attendance Report, Fine
Report, Tomorrow Booking Report, Expense Report, Grocery Report. Daily
Attendance, Fine, and Tomorrow Booking now show summary cards above the
table (Total Breakfast/Lunch/Dinner Count, Total Fine Amount, Total
Breakfast/Lunch/Dinner Bookings respectively) — Fine Report also groups
by student, so "Fine Date(s)" lists every date they were charged with a
single total amount, instead of one row per fine event. **Every export
(Excel/PDF) now includes those same summary figures**, not just the raw
table — see `exportToExcelWithSummary`/`exportToPDFWithSummary` in
`utils.js`.

**Meal Entries restructured**: six summary cards at the top (Today's
Meals + Tomorrow's Bookings, Breakfast/Lunch/Dinner each), then "Today's
Meal Marking" (editable — same booking-only, today-only override modal
as before) shown first, then a read-only "Tomorrow Booking" table below
it. Both tables render in a new "flat" mode
(`renderTable(..., { flat: true })` / `.data-table--flat` in
`css/main.css`) that keeps a real horizontally-scrolling table on mobile
instead of the stacked-card view used elsewhere in the app, per an
explicit "same table on desktop and mobile" requirement. Both still only
list students with at least one meal booked Yes/Double.

**Today's Confirmation is now pre-filled and locked by default.** A
meal shows exactly what was booked yesterday and can't be touched at
all — UNLESS the admin has enabled No Food for that specific meal
(Admin → Settings → No Food Option), in which case the usual Yes/No/No
Food/Double option group appears, editable as before. This isn't just a
UI restriction: the database trigger (`enforce_booking_write` in
`sql/schema.sql`) rejects any `confirmed_status` write from a student for
a meal where No Food is disabled, full stop. The one thing this changes
underneath: since a locked meal's `confirmed_status` would otherwise stay
null forever (nobody's allowed to set it), the nightly
`lock-confirmations` Edge Function now auto-copies `booking_status` into
`confirmed_status` for any such meal before locking and running the fine
sweep — so the ₹100 "never confirmed" fine still only fires when it's
supposed to (a booked meal where No Food _was_ available and the student
genuinely never acted), not every day for every student by default.
**Redeploy `lock-confirmations` after applying
`sql/PATCH_2026-07-24_locked_confirmation.sql`** to a live database, or
the trigger and the nightly job will disagree with each other.
`js/student/booking.js` (tomorrow's booking) is untouched, exactly as
asked.

## Reports: data-source fix, Monthly Attendance, period-aware exports

**Fixed a real mismatch**: "Daily Attendance Report" (now renamed —
see below) read `confirmed_status`, while Meal Entries' "Today's Meal
Marking" table reads `booking_status`. Since the locked-confirmation
change means `confirmed_status` often stays null until the nightly
`lock-confirmations` sweep runs, the report could show stale or missing
data mid-day even though Meal Entries was already correct. The report
now reads `booking_status` — the exact same field, same query shape —
so the two can never disagree again. It also now only lists students
with at least one meal booked Yes/Double, matching Meal Entries exactly.

**Renamed** "Daily Attendance Report" → **"Today's Marking Report"**.

**Added Monthly Attendance Report** — one row per student, one column
per day of the selected month (e.g. `Jul-01`, `Jul-02`, …), each cell
stacking all three meals (`BF: Yes` / `LN: No` / `DN: No`). Falls back
to `confirmed_status` where it's been set (so a day where a student
genuinely changed their meal via No Food shows what actually happened),
otherwise `booking_status`. Renders in the same "flat" table mode as
Meal Entries so the many day-columns scroll horizontally instead of
stacking into absurdly tall mobile cards.

**Exports are now period-aware, not download-date-aware.** Every
report's Excel/PDF filename and PDF title now include the actual
selected reporting date/month/range (`computePeriod()` in
`reports.js`) — e.g. `attendance-2026-07-24.xlsx` or
`monthly_attendance-2026-07.pdf` — instead of always looking the same
regardless of when it's opened later. A "Showing: …" line above the
table shows the same thing on screen, so it's obvious which period
you're looking at before you even export.

## Monthly Attendance: grouped Excel export, date filtering, and a real layout bug fix

**Excel export now uses genuine grouped columns** for Monthly
Attendance — a merged parent header cell per date (e.g. `Jun-01`)
spanning three real sub-columns (Breakfast / Lunch / Dinner) underneath,
built with `XLSX` sheet merges (`exportMonthlyAttendanceExcel()` in
`reports.js`), not just stacked text in one cell. PDF/print still use
the flattened single-column-per-day version — only Excel gets the
spreadsheet-native treatment, since that's where it's actually useful
(sorting/filtering per meal type).

**Date-visibility filter**: a day column (in both the on-screen table
and the Excel export — computed once and shared) only appears if at
least one student had at least one meal marked Yes/Double that day.
Computed across every student regardless of the current name search, so
searching for one student doesn't hide days just because _they_ didn't
eat that day.

**Fixed the actual cause of the "not responsive" table bug** — this
wasn't a missing media query, it was a classic flexbox/grid gotcha:
flex and grid children have an implicit `min-width: auto`, which means
once a wide table (Monthly Attendance can have 90+ day-columns) sits
inside one, the browser refuses to let that container shrink below the
table's intrinsic content width — so the _entire page_ was overflowing
sideways instead of just the table's own `.table-wrap` scrolling
internally the way it was supposed to. Fixed by adding `min-width: 0`
to `.card` (a flex item in `.page`) and to a newly-added
`.app-shell__content` class on the desktop grid's content column (the
`1fr` track has the identical problem, just via CSS Grid instead of
Flexbox), plus hardening `.table-wrap` itself with explicit
`width/max-width: 100%`. Table headers now stay properly aligned with
their data while scrolling as a direct consequence — they're the same
`<table>` element, so once the container itself stops overflowing,
there's nothing left for them to visually separate from.

## Meal Entries: "Add Entry" for backfilling missing entries

New button on Today's Meal Marking, for a real gap in the previous
design: if a student never opened the app (no row exists for them at
all that day), they simply didn't show up anywhere — there was no way
to manually create their entry. Add Entry fixes this:

- **Date**: today or yesterday only (native `min`/`max` on the date
  input); future dates disabled.
- **Room Number**: dropdown of every room with an active student.
- **Student Name**: disabled until a room is picked, then populated
  with only the students in that room who have **zero** booking rows
  for the selected date — a student who already has any entry (however
  it looks) doesn't appear, so duplicates are structurally impossible,
  not just discouraged.
- **Meal Selection**: Yes/No/Double/No Food per meal, all three
  required before Save enables.

One data-model detail worth knowing: **No Food can only ever live in
`confirmed_status`** — `booking_status`'s `CHECK` constraint doesn't
allow it. So selecting No Food for a meal writes
`booking_status='yes'` + `confirmed_status='no_food'` (the one
combination the fine logic already recognizes as the deliberate
no-fine exception); every other choice writes the same value to both
columns, so the entry is immediately consistent — no mismatch, no fine,
exactly as if the student had booked and confirmed it themselves.

**Database change required**: the trigger previously only allowed an
admin to write today's or tomorrow's date. It now also allows
yesterday's date, but _only for brand-new rows_ (`TG_OP = 'INSERT'`) —
never an update of something that already exists there. This is
deliberately narrow: it's exactly what Add Entry needs and nothing
more; the existing per-student Edit override on Meal Entries is still
today-only, unchanged. Run **`sql/PATCH_2026-07-30_add_entry.sql`** on
a live database.

No other part of the app needed to change — Dashboard, both Attendance
reports, and everything else read directly from the same `bookings`
table, so a backfilled entry surfaces everywhere automatically the
moment it's saved.

**Correction**: "already marked" (the check that hides a student from
the Student dropdown) originally meant "has any row at all for that
date" — but the nightly sweep auto-fills every untouched meal to "No"
every night, so nearly every student already has such a row for
yesterday, making them permanently invisible to Add Entry even though
nothing meaningful had actually been recorded for them. Fixed to match
the same "at least one Yes/Double" definition used everywhere else in
the app (Meal Entries, both Attendance reports) — a student whose rows
are all "No" is still treated as available. The trigger's yesterday
restriction was relaxed to match: an `UPDATE` to yesterday's date is
now allowed when the existing row isn't a real entry yet (mirrors the
same check), not just a fresh `INSERT`— otherwise Add Entry's upsert
would hit that auto-filled row and get rejected. A genuinely
already-marked yesterday entry still can't be overwritten this way.

## Fine calculation removed entirely

No fine is ever charged anymore, anywhere — the ₹250 mismatch fine and
₹100 no-confirmation fine are both gone. Every call site was removed,
not just hidden:

- `recompute_daily_fine()` (in `sql/schema.sql`) is now a genuine
  no-op — nothing calls it anymore, but it's kept as an inert stub
  (rather than dropped) so a stale cached client build that still
  tries the RPC gets a harmless success instead of a hard error.
- The nightly `lock-confirmations` Edge Function no longer runs the
  fine sweep — it still locks confirmations and auto-copies
  `booking_status` into `confirmed_status` for No-Food-disabled meals
  (that part has nothing to do with fines; it's what keeps reports
  meaningful), it just doesn't call `recompute_daily_fine` afterward
  anymore.
- Removed from the UI entirely: Fine Report (Reports), Fine Amounts
  (Admin → Settings), "Fine Collection" card (Admin Dashboard),
  "Fines this month" card and Fine Amount column (Student
  Dashboard/History).
- Admin's meal override still keeps `confirmed_status` in sync with a
  changed `booking_status` for the specific meal touched — that logic
  was originally there to prevent a false fine, but it's kept because
  it's still useful independent of fines: without it, Students
  Report / Monthly Attendance Report (which read `confirmed_status`)
  would keep showing the old value even after an admin's correction.
- Admin Dashboard's "Monthly Revenue" figure is now just payments
  collected — it no longer adds fine collection on top, since there's
  no fine collection to add.

**What was deliberately left alone, and why**: the `fines` table and
`bookings.fine_amount` column both still exist with any historical
data intact — nothing reads or writes them anymore, but dropping them
outright felt like a separate, more destructive decision than "stop
calculating new fines." If you're confident you don't need that
history, `sql/OPTIONAL_drop_fines_table.sql` removes the table,
its RLS policies, and the function outright (not reversible).

**Database change required**: run
`sql/PATCH_2026-08-04_remove_fines.sql` on a live database (replaces
`recompute_daily_fine()` with the no-op and removes the two
now-unused fine-amount settings rows), then redeploy
`lock-confirmations`:

```bash
supabase functions deploy lock-confirmations
```

## Fixed: deleted/rejected students blocking re-registration with "already registered"

This looked like a Delete bug but wasn't — `admin-delete-student`'s hard
delete via the Admin API was always correct. The real bug was in
**registration**: `submitRegistration` used to call `auth.signUp()` and
then insert the `students` row as two separate client-side steps. If the
second step ever failed for any reason (network blip, a conflict, anything),
the auth login from the first step was never cleaned up — leaving an
orphaned login with no matching `students` row. That's invisible
everywhere in the admin UI (not in Students, not in Registrations), but
the email stays permanently locked in Supabase Auth, so any future
registration attempt with that email fails with "already registered" and
there's nothing visible for an admin to delete.

Fixed by moving the whole registration into one atomic Edge Function
(**`student-register`**) that creates the auth login and the `students`
row together, server-side, and rolls back the auth login if the insert
fails. `js/auth.js`'s `submitRegistration` now just calls this function
instead of doing the two steps itself.

**If this already happened to you** (an email says "already registered"
but you've never approved or rejected anyone with that email), see
**`supabase/CLEANUP_orphaned_auth_users.md`** — a read-only SQL query to
find any orphaned logins, plus how to safely clear them (not via raw SQL
`DELETE FROM auth.users`, which can leave Supabase's internal
session/identity tables inconsistent — use the Dashboard or the Admin
REST API instead, both covered in that file).

**Deploy required**: `supabase functions deploy student-register`

## Fixed: Today's Confirmation and Tomorrow's Booking locking each other

Reported symptom: submitting Today's Confirmation (or just the evening
window closing from normal time passing) could make Tomorrow's Booking
look locked too, even though nothing about the confirmation itself
caused it. Root cause: both features checked the same
`booking_open_time`/`booking_close_time` window (see the "shared
window" changelog entry further down — this supersedes it for
Confirmation specifically).

Fixed by removing the window check from confirmation entirely — Today's
Confirmation is now gated ONLY by two things: whether it's already been
submitted (`confirmation_locked`), and whether the admin has enabled No
Food for that specific meal. No time-of-day check at all. Tomorrow's
Booking is unchanged — it still uses the window exactly as before. The
two now share no state or settings key, so one can never affect the
other's editability, at either layer:

- **Client** (`js/student/confirmation.js`): when a meal is editable
  (No Food enabled for it), only two options are ever shown — the
  patched value carried over from yesterday's booking, and No Food.
  Nothing else. A non-editable meal shows the patched value read-only
  with no option group at all.
- **Database** (`enforce_booking_write` in `sql/schema.sql`): the
  `confirmed_status` branch of the trigger no longer references the
  window at all — only the lock flag and the per-meal No Food setting.

**Deploy required** — this needs the database patch or the old trigger
(which still ties confirmation to the window) stays in effect no
matter what the frontend code does:
`sql/PATCH_2026-08-10_decouple_confirmation_window.sql`

## Fixed: submission requiring a change, and confirmed-status data consistency

**Today's Confirmation no longer requires changing the patched value
before submitting.** Previously, submitting was blocked with "select a
different option" unless at least one meal's selection actually
differed from the patched value — meaning a student who genuinely
wanted to confirm "yes, that's still right" couldn't submit at all.
Removed that check entirely (`js/student/confirmation.js`); Submit now
sends every editable meal with a real selection, whether it matches the
patched value or was switched to No Food.

**Real data-consistency bug found and fixed**: switching a meal to No
Food only ever writes `confirmed_status` (that's the only field it can
touch) — but several screens were reading `booking_status` only, so
the change was invisible there even though it showed correctly in the
student's own History. Added one shared helper,
`effectiveMealStatus()` (`js/utils.js`) — confirmed_status if the
student has confirmed something, otherwise falls back to
booking_status — and switched every screen that displays or counts a
meal's current state to use it:

- Admin Meal Entries — both the "Today's Meal Marking" table and its
  Breakfast/Lunch/Dinner summary-card counts.
- Admin Dashboard — the "Today's Meals" card. This used to show
  separate "Booked" and "Confirmed" rows, which had its own bug: a No
  Food confirmation was counted as a _positive_ number in the Confirmed
  row (`!== 'no'` doesn't exclude `'no_food'`). Replaced with a single
  effective-count row that genuinely matches Meal Entries and Reports,
  instead of two raw numbers that could each drift for different
  reasons.
- Reports — "Today's Marking Report" and "Monthly Attendance Report."
- Students Report's monthly totals — previously filtered
  `confirmed_status IN ('yes','double')` directly in the query, which
  undercounted any meal not yet auto-copied overnight (i.e. most of
  today, every day). Now computed the same way as everywhere else.
- Student's own home screen (the thali-ring status widget) — was
  showing "pending" for a meal that's actually already locked to the
  booking, before the nightly auto-copy ever runs.

**Also fixed while in here**: the CSS class for a No Food badge was
`.badge-nofood`, but every call site builds the class name as
`badge-${status}` where the actual value is `no_food` (with an
underscore) — so a No Food badge was silently unstyled everywhere it
appeared. Renamed the CSS class to `.badge-no_food` to match.

No database changes this round — everything above is client-side only.

## Fixed: PDF export showing blank values, and Double now counts as 2 meals

**PDF export bug**: Excel worked, PDF didn't — same underlying data,
different bug. Both exports receive rows pre-flattened and keyed by
column **label** (e.g. `'Student Name'`), not by the original column
`key` (e.g. `'name'`). Excel's `sheet_add_json` just uses each row's own
keys directly, so it worked regardless. PDF's table-builder was looking
up `r[c.key]` — which doesn't exist on a label-keyed row — so every
cell came back empty. Fixed both `exportToPDF` and
`exportToPDFWithSummary` (`js/utils.js`) to look up by `c.label`
instead, matching the actual shape of the data they're given.

**Meal counting is now portion-weighted, not headcount**: Yes = 1
meal, Double = 2 meals, everywhere a total is calculated — added one
shared helper, `mealCount()` (`js/utils.js`), and applied it to every
actual total in the app:

- Meal Entries' six summary cards (Today's Meals / Tomorrow's Bookings)
- Admin Dashboard's "Today's Meals" card
- Today's Marking Report and Tomorrow Booking Report's summary cards
- Students Report's monthly Breakfast/Lunch/Dinner totals

Deliberately left as **boolean** (unchanged) — these answer "is there
any activity to show," not "how many portions," so weighting them
would have been wrong: which students appear in Meal Entries' two
tables and both reports (the "at least one Yes/Double" visibility
filter), Today's Status ("Full 3/3" / "Partial") since that's about how
many of the day's 3 meal slots were used, Monthly Attendance's
date-visibility filter, and Add Entry's "already marked" check.

Because exports just render whatever `rows`/`summary` values the fetch
functions compute, fixing the counting at the source means every
export automatically reflects the correct portion-weighted totals too
— no separate export-side logic needed.

No database changes this round — everything above is client-side only.

## Not yet wired up (clearly-scoped follow-ups)

- Image/bill uploads for expenses (`expenses.bill_url` column exists;
  hook up Supabase Storage when needed).
- Audit log writes (`audit_logs` table exists with RLS; not yet called
  from the admin UI actions — straightforward to add per action).
