// ============================================================================
// admin/meals.js — Meal Entries page.
//
// Layout:
//   1. Six summary cards: Today's Meals (B/L/D totals) + Tomorrow's
//      Bookings (B/L/D totals).
//   2. "Today's Meal Marking" table — TODAY's effective status per student
//      per meal (see utils.js:effectiveMealStatus — confirmed_status if the
//      student has confirmed something, e.g. via No Food, otherwise falls
//      back to what was booked yesterday evening). Editable via the
//      override modal, but ONLY today's date — the DB trigger itself
//      refuses any admin write to another date for an individual student.
//   3. "Tomorrow Booking" table — TOMORROW's booking status per student
//      (there's no confirmation process for a future date yet, so this is
//      always just the raw booking), read-only — only the bulk-cancel
//      action below is allowed to touch tomorrow's date.
//
// Both tables only list students with at least one meal at Yes/Double
// (by effective status) for that respective day — a student who booked No
// everywhere, or switched to No Food, has nothing for the kitchen to act
// on, so they're hidden rather than cluttering the list.
//
// Both tables render in "flat" mode (see Table.js / css/main.css
// .data-table--flat) so mobile shows the same real scrollable table as
// desktop, not the stacked-card view used elsewhere in the app.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from "../config.js";
import {
  todayISO,
  tomorrowISO,
  formatDate,
  debounce,
  effectiveMealStatus,
} from "../utils.js";
import { renderTable } from "../components/Table.js";
import { statCard } from "../components/Card.js";
import { openModal, closeModal, confirmDialog } from "../components/Modal.js";
import { toast } from "../components/Toast.js";

export async function renderMeals(root) {
  const today = todayISO();
  const tomorrow = tomorrowISO();

  root.innerHTML = `
    <div id="mealsSummary" class="card-grid"></div>



    <div class="card">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px;">
        <h3 style="margin:0;">Today's Meal Marking <span class="badge badge-locked">${formatDate(today)}</span></h3>
        <button class="btn btn-primary btn-sm" id="addEntryBtn"><i class="fa-solid fa-plus"></i> Add Entry</button>
      </div>
      <p class="text-soft" style="font-size:13px;">Overrides only apply to today. Only students with at least one meal booked Yes/Double are listed.</p>
      <div class="filter-bar">
        <input type="text" id="filterNameToday" placeholder="Search name or room…">
      </div>
      <div id="todayTable"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
    </div>

    <div class="card">
      <h3>Tomorrow Booking <span class="badge badge-locked">${formatDate(tomorrow)}</span></h3>
      <p class="text-soft" style="font-size:13px;">Read-only — what students have booked so far tonight for tomorrow. Use Bulk Cancel above to change a meal for everyone at once.</p>
      <div class="filter-bar">
        <input type="text" id="filterNameTomorrow" placeholder="Search name or room…">
      </div>
      <div id="tomorrowTable"><div class="skeleton" style="height:200px;border-radius:16px;"></div></div>
    </div>
    
        <div class="card">
      <h3>Bulk Cancel a Meal</h3>
      <p class="text-soft" style="font-size:13px;">Cancelling sets every student's booking for that meal to "No" and locks it.</p>
      <div class="filter-bar">
        <select id="cancelDay"><option value="${today}">Today</option><option value="${tomorrow}">Tomorrow</option></select>
        <select id="cancelMeal">${MEAL_TYPES.map((m) => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join("")}</select>
        <button class="btn btn-danger btn-sm" id="cancelMealBtn"><i class="fa-solid fa-ban"></i> Cancel Meal</button>
      </div>
    </div>
  `;

  const state = { searchToday: "", searchTomorrow: "" };
  let todayRowsCache = [];

  async function loadSummary() {
    const [{ data: todayBookings }, { data: tomorrowBookings }] =
      await Promise.all([
        supabase
          .from("bookings")
          .select("meal_type, booking_status, confirmed_status")
          .eq("date", today),
        supabase
          .from("bookings")
          .select("meal_type, booking_status, confirmed_status")
          .eq("date", tomorrow),
      ]);
    const todayCounts = countByMeal(todayBookings);
    const tomorrowCounts = countByMeal(tomorrowBookings);

    document.getElementById("mealsSummary").innerHTML = `
      ${statCard({ label: "Today's Breakfast", value: todayCounts.breakfast, icon: "fa-mug-hot" })}
      ${statCard({ label: "Today's Lunch", value: todayCounts.lunch, icon: "fa-bowl-food" })}
      ${statCard({ label: "Today's Dinner", value: todayCounts.dinner, icon: "fa-utensils" })}
      ${statCard({ label: "Tomorrow's Breakfast", value: tomorrowCounts.breakfast, icon: "fa-mug-hot" })}
      ${statCard({ label: "Tomorrow's Lunch", value: tomorrowCounts.lunch, icon: "fa-bowl-food" })}
      ${statCard({ label: "Tomorrow's Dinner", value: tomorrowCounts.dinner, icon: "fa-utensils" })}
    `;
  }

  function countByMeal(rows) {
    const out = { breakfast: 0, lunch: 0, dinner: 0 };
    (rows || []).forEach((r) => {
      out[r.meal_type] += bookingCountValue(r.booking_status);
    });
    return out;
  }

  function bookingCountValue(status) {
    if (status === "double") return 2;
    if (status === "yes") return 1;
    return 0;
  }

  async function loadTodayTable() {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, student_id, meal_type, booking_status, confirmed_status, cancelled_by_admin, students(name, room_number)",
      )
      .eq("date", today);
    if (error) {
      document.getElementById("todayTable").innerHTML =
        `<p class="text-danger">Failed to load entries.</p>`;
      return;
    }

    let rows = groupByStudent(data);
    rows = rows.filter((r) =>
      MEAL_TYPES.some((m) =>
        ["yes", "double"].includes(effectiveMealStatus(r.meals[m])),
      ),
    );
    if (state.searchToday) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(state.searchToday) ||
          r.room.toLowerCase().includes(state.searchToday),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));
    todayRowsCache = rows;

    const columns = [
      { key: "name", label: "Student Name" },
      { key: "room", label: "Room No" },
      ...MEAL_TYPES.map((meal) => ({
        key: meal,
        label: MEAL_LABELS[meal],
        render: (r) => bookingBadgeHTML(effectiveMealStatus(r.meals[meal])),
      })),
      {
        key: "actions",
        label: "Actions",
        render: (r) =>
          `<button class="btn btn-secondary btn-sm" data-act="edit" data-student="${r.student_id}">Edit</button>`,
      },
    ];
    document.getElementById("todayTable").innerHTML = renderTable(
      columns,
      rows,
      {
        emptyMessage: "No students have booked any meal for today yet",
        flat: true,
      },
    );
    document.querySelectorAll('[data-act="edit"]').forEach(
      (b) =>
        (b.onclick = () =>
          openOverrideModal(
            todayRowsCache.find((r) => r.student_id === b.dataset.student),
            today,
            () => {
              loadTodayTable();
              loadSummary();
            },
          )),
    );
  }

  async function loadTomorrowTable() {
    const { data, error } = await supabase
      .from("bookings")
      .select(
        "id, student_id, meal_type, booking_status, confirmed_status, students(name, room_number)",
      )
      .eq("date", tomorrow);
    if (error) {
      document.getElementById("tomorrowTable").innerHTML =
        `<p class="text-danger">Failed to load entries.</p>`;
      return;
    }

    let rows = groupByStudent(data);
    rows = rows.filter((r) =>
      MEAL_TYPES.some((m) =>
        ["yes", "double"].includes(effectiveMealStatus(r.meals[m])),
      ),
    );
    if (state.searchTomorrow) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(state.searchTomorrow) ||
          r.room.toLowerCase().includes(state.searchTomorrow),
      );
    }
    rows.sort((a, b) => a.name.localeCompare(b.name));

    const columns = [
      { key: "name", label: "Student Name" },
      { key: "room", label: "Room No" },
      ...MEAL_TYPES.map((meal) => ({
        key: meal,
        label: MEAL_LABELS[meal],
        render: (r) => bookingBadgeHTML(effectiveMealStatus(r.meals[meal])),
      })),
    ];
    document.getElementById("tomorrowTable").innerHTML = renderTable(
      columns,
      rows,
      {
        emptyMessage: "No students have booked anything for tomorrow yet",
        flat: true,
      },
    );
  }

  function groupByStudent(data) {
    const byStudent = {};
    (data || []).forEach((r) => {
      const key = r.student_id;
      byStudent[key] = byStudent[key] || {
        student_id: key,
        name: r.students?.name || "—",
        room: r.students?.room_number || "—",
        meals: {},
      };
      byStudent[key].meals[r.meal_type] = r;
    });
    return Object.values(byStudent);
  }

  function bookingBadgeHTML(status) {
    if (!status)
      return '<span class="text-soft" style="font-size:12px;">—</span>';
    return `<span class="badge badge-${status}">${STATUS_LABELS[status]}</span>`;
  }

  document.getElementById("filterNameToday").addEventListener(
    "input",
    debounce((e) => {
      state.searchToday = e.target.value.toLowerCase();
      loadTodayTable();
    }, 250),
  );
  document.getElementById("filterNameTomorrow").addEventListener(
    "input",
    debounce((e) => {
      state.searchTomorrow = e.target.value.toLowerCase();
      loadTomorrowTable();
    }, 250),
  );

  document.getElementById("addEntryBtn").addEventListener("click", () => {
    openAddEntryModal(() => {
      loadSummary();
      loadTodayTable();
      loadTomorrowTable();
    });
  });

  document
    .getElementById("cancelMealBtn")
    .addEventListener("click", async () => {
      const date = document.getElementById("cancelDay").value;
      const meal = document.getElementById("cancelMeal").value;
      const ok = await confirmDialog(
        `Cancel ${MEAL_LABELS[meal]} for ${formatDate(date)}? All students' bookings for this meal become "No" and read-only.`,
        { confirmLabel: "Cancel Meal" },
      );
      if (!ok) return;

      const { data: activeStudents } = await supabase
        .from("students")
        .select("id")
        .eq("status", "active");
      const rows = (activeStudents || []).map((s) => ({
        student_id: s.id,
        date,
        meal_type: meal,
        booking_status: "no",
        booking_locked: true,
        confirmed_status: "no",
        confirmation_locked: true,
        confirmed_at: new Date().toISOString(),
        cancelled_by_admin: true,
      }));
      const { error } = await supabase
        .from("bookings")
        .upsert(rows, { onConflict: "student_id,date,meal_type" });
      if (error) {
        toast.error("Could not cancel meal");
        return;
      }
      toast.success(`${MEAL_LABELS[meal]} cancelled for ${formatDate(date)}`);
      loadSummary();
      loadTodayTable();
      loadTomorrowTable();
    });

  loadSummary();
  loadTodayTable();
  loadTomorrowTable();
}

function openOverrideModal(studentRow, date, onSaved) {
  const bookingOptions = ["yes", "no", "double"];

  const sectionsHTML = MEAL_TYPES.map((meal) => {
    const row = studentRow.meals[meal];
    const confirmedLabel = row?.confirmed_status
      ? STATUS_LABELS[row.confirmed_status]
      : "Not yet confirmed by student";
    return `
      <div style="margin-bottom:20px;" data-meal-section="${meal}">
        <h4>${MEAL_LABELS[meal]}</h4>
        <p class="text-soft" style="font-size:12px;margin:0 0 6px;">Booking (set yesterday for today)</p>
        <div class="option-group">${bookingOptions.map((o) => `<button class="option-btn ${row?.booking_status === o ? "is-selected" : ""}" data-meal="${meal}" data-value="${o}">${STATUS_LABELS[o]}</button>`).join("")}</div>
        <p class="text-soft" style="font-size:12px;margin:10px 0 0;"><i class="fa-solid fa-lock"></i> Confirmed: ${confirmedLabel} — set by the student, not editable here</p>
      </div>
      <hr class="divider">
    `;
  }).join("");

  const body = openModal({
    title: `Override Booking — ${studentRow.name} (Today)`,
    bodyHTML: `${sectionsHTML}<button class="btn btn-primary btn-block" id="saveOverride">Save Changes</button>`,
  });

  const newValues = {};
  MEAL_TYPES.forEach((meal) => {
    newValues[meal] = studentRow.meals[meal]?.booking_status || null;
  });

  body.querySelectorAll(".option-btn").forEach((btn) => {
    btn.onclick = () => {
      const { meal, value } = btn.dataset;
      body
        .querySelectorAll(`[data-meal="${meal}"]`)
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      newValues[meal] = value;
    };
  });

  body.querySelector("#saveOverride").onclick = async () => {
    const saveBtn = body.querySelector("#saveOverride");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const payload = MEAL_TYPES.map((meal) => {
      const original = studentRow.meals[meal]?.booking_status || null;
      const row = {
        student_id: studentRow.student_id,
        date,
        meal_type: meal,
        booking_status: newValues[meal],
      };
      // If this meal's booking actually changed, keep confirmed_status in
      // sync with it — otherwise the Students Report / Monthly Attendance
      // Report (which read confirmed_status for their totals) would still
      // show the OLD value for this meal even though the admin just
      // corrected the booking. Only the meal(s) actually changed are
      // touched here — an untouched meal's real confirmed_status (e.g. a
      // student's own No Food choice) is never overwritten.
      if (newValues[meal] !== original) {
        row.confirmed_status = newValues[meal];
        row.confirmation_locked = true;
        row.confirmed_at = new Date().toISOString();
      }
      return row;
    });

    const { error } = await supabase
      .from("bookings")
      .upsert(payload, { onConflict: "student_id,date,meal_type" });
    if (error) {
      toast.error("Could not save overrides");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Changes";
      return;
    }

    toast.success("Overrides saved");
    closeModal();
    onSaved();
  };
}

/**
 * "Add Entry" — backfills a student who has ZERO booking rows at all for
 * the selected date (today or yesterday only — see enforce_booking_write()
 * in sql/schema.sql, which only allows an admin to INSERT, never UPDATE, a
 * row for yesterday's date). The Student dropdown only ever lists students
 * with no existing entry for the chosen date, so this can't create a
 * duplicate or silently overwrite something the student or admin already
 * set.
 *
 * Meal Selection offers Yes/No/Double/No Food per meal. No Food can only
 * ever live in confirmed_status (booking_status's CHECK constraint doesn't
 * allow it), so selecting it writes booking_status='yes' + confirmed_status
 * ='no_food'. Every other choice writes the same value to both columns, so
 * the entry is immediately consistent — exactly as if the student had
 * booked and confirmed it themselves.
 */
async function openAddEntryModal(onSaved) {
  const today = todayISO();
  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();

  const body = openModal({
    title: "Add Entry",
    bodyHTML: `
      <div class="field"><input type="date" id="aeDate" min="${yesterday}" max="${today}" value="${today}" placeholder=" "><label>Date</label></div>
      <div class="field">
        <select id="aeRoom" class="has-value"><option value="">Select a room…</option></select>
        <label>Room Number</label>
      </div>
      <div class="field">
        <select id="aeStudent" class="has-value" disabled><option value="">Select a room first…</option></select>
        <label>Student Name</label>
      </div>
      <p id="aeStudentNote" class="text-soft" style="font-size:12px;"></p>

      ${MEAL_TYPES.map(
        (meal) => `
        <div style="margin-bottom:16px;" data-ae-meal="${meal}">
          <h4>${MEAL_LABELS[meal]}</h4>
          <div class="option-group option-group--4">
            ${["yes", "no", "double", "no_food"].map((o) => `<button class="option-btn" data-ae-group="${meal}" data-value="${o}">${STATUS_LABELS[o]}</button>`).join("")}
          </div>
        </div>
      `,
      ).join("")}

      <button class="btn btn-primary btn-block" id="aeSave" disabled>Save Entry</button>
    `,
  });

  const selection = { breakfast: null, lunch: null, dinner: null };
  let selectedStudentId = null;

  body.querySelectorAll(".option-btn").forEach((btn) => {
    btn.onclick = () => {
      const meal = btn.dataset.aeGroup;
      body
        .querySelectorAll(`[data-ae-group="${meal}"]`)
        .forEach((b) => b.classList.remove("is-selected"));
      btn.classList.add("is-selected");
      selection[meal] = btn.dataset.value;
      syncSaveEnabled();
    };
  });

  function syncSaveEnabled() {
    const allMealsChosen = MEAL_TYPES.every((m) => selection[m] !== null);
    body.querySelector("#aeSave").disabled = !(
      selectedStudentId && allMealsChosen
    );
  }

  async function loadRooms() {
    const { data } = await supabase
      .from("students")
      .select("room_number")
      .eq("status", "active");
    const rooms = [...new Set((data || []).map((r) => r.room_number))].sort(
      (a, b) => a.localeCompare(b, undefined, { numeric: true }),
    );
    const select = body.querySelector("#aeRoom");
    select.innerHTML =
      '<option value="">Select a room…</option>' +
      rooms.map((r) => `<option value="${r}">${r}</option>`).join("");
  }

  async function loadStudentsForRoom() {
    const room = body.querySelector("#aeRoom").value;
    const date = body.querySelector("#aeDate").value;
    const studentSelect = body.querySelector("#aeStudent");
    const note = body.querySelector("#aeStudentNote");
    selectedStudentId = null;
    syncSaveEnabled();

    if (!room) {
      studentSelect.disabled = true;
      studentSelect.innerHTML =
        '<option value="">Select a room first…</option>';
      note.textContent = "";
      return;
    }

    studentSelect.disabled = true;
    studentSelect.innerHTML = '<option value="">Loading…</option>';

    const { data: roomStudents } = await supabase
      .from("students")
      .select("id, name")
      .eq("status", "active")
      .eq("room_number", room);
    const ids = (roomStudents || []).map((s) => s.id);

    // "already marked" means the same thing it means everywhere else in
    // this app (Meal Entries, both Attendance reports): at least one meal
    // is Yes or Double. A student whose rows are all "No" (or "No Food")
    // hasn't really been given a meaningful entry — that's usually just
    // the nightly lock-bookings sweep auto-filling an untouched meal to
    // "No" — so they should still show up here as available, not be
    // silently excluded.
    let alreadyMarked = new Set();
    if (ids.length) {
      const { data: existing } = await supabase
        .from("bookings")
        .select("student_id, booking_status, confirmed_status")
        .eq("date", date)
        .in("student_id", ids);
      (existing || []).forEach((r) => {
        if (
          ["yes", "double"].includes(r.booking_status) ||
          ["yes", "double"].includes(r.confirmed_status)
        ) {
          alreadyMarked.add(r.student_id);
        }
      });
    }

    const available = (roomStudents || [])
      .filter((s) => !alreadyMarked.has(s.id))
      .sort((a, b) => a.name.localeCompare(b.name));

    studentSelect.disabled = false;
    if (!available.length) {
      studentSelect.innerHTML =
        '<option value="">No unmarked students in this room</option>';
      note.textContent = `Every student in room ${room} already has an entry for this date.`;
    } else {
      studentSelect.innerHTML =
        '<option value="">Select a student…</option>' +
        available
          .map((s) => `<option value="${s.id}">${s.name}</option>`)
          .join("");
      note.textContent = `Showing only students in room ${room} with no entry yet for this date.`;
    }
  }

  body.querySelector("#aeRoom").addEventListener("change", loadStudentsForRoom);
  body.querySelector("#aeDate").addEventListener("change", loadStudentsForRoom);
  body.querySelector("#aeStudent").addEventListener("change", (e) => {
    selectedStudentId = e.target.value || null;
    syncSaveEnabled();
  });

  body.querySelector("#aeSave").addEventListener("click", async () => {
    const saveBtn = body.querySelector("#aeSave");
    saveBtn.disabled = true;
    saveBtn.textContent = "Saving…";

    const date = body.querySelector("#aeDate").value;
    const payload = MEAL_TYPES.map((meal) => {
      const choice = selection[meal];
      const statuses =
        choice === "no_food"
          ? { booking_status: "yes", confirmed_status: "no_food" }
          : { booking_status: choice, confirmed_status: choice };
      return {
        student_id: selectedStudentId,
        date,
        meal_type: meal,
        ...statuses,
        booking_locked: true,
        booked_at: new Date().toISOString(),
        confirmation_locked: true,
        confirmed_at: new Date().toISOString(),
      };
    });

    const { error } = await supabase
      .from("bookings")
      .upsert(payload, { onConflict: "student_id,date,meal_type" });
    if (error) {
      toast.error(error.message || "Could not save entry");
      saveBtn.disabled = false;
      saveBtn.textContent = "Save Entry";
      return;
    }

    if (date === today) {
      toast.success("Entry added");
    } else {
      toast.success(
        "Entry added for yesterday — check Reports → Today's Marking Report with that date to verify it",
      );
    }
    closeModal();
    onSaved();
  });

  await loadRooms();
}
