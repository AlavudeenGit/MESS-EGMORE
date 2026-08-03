// ============================================================================
// admin/reports.js — 6 report types. Every report returns { rows, summary,
// columns? } from its fetch() — summary (an array of { label, value } pairs,
// or empty) is rendered as cards above the table AND passed into the export
// functions, so the downloaded Excel/PDF file always shows the exact same
// figures as the screen. `columns` is optional per-fetch (used by Monthly
// Attendance, whose columns are dynamic per selected month) — falls back to
// the report type's static columns() otherwise.
//
// Exports are PERIOD-aware, not download-date-aware: the title and filename
// always reflect the selected reporting date/month/range (computed by
// computePeriod() below), never the date the file happens to be downloaded.
// ============================================================================
import {
  supabase,
  MEAL_TYPES,
  STATUS_LABELS,
  EXPENSE_CATEGORY_LABELS,
} from "../config.js";
import {
  formatDate,
  currency,
  todayISO,
  tomorrowISO,
  exportToExcelWithSummary,
  exportToPDFWithSummary,
  effectiveMealStatus,
  mealCount,
} from "../utils.js";
import { renderTable } from "../components/Table.js";
import { statCard } from "../components/Card.js";

const REPORT_TYPES = {
  student: {
    label: "Students Report",
    filters: ["search"],
    fetch: fetchStudentsReport,
    columns: studentColumns(),
  },
  attendance: {
    label: "Today's Marking Report",
    filters: ["search", "date"],
    fetch: fetchAttendanceReport,
    columns: attendanceColumns(),
  },
  monthly_attendance: {
    label: "Monthly Attendance Report",
    filters: ["search", "month"],
    flat: true,
    fetch: fetchMonthlyAttendanceReport,
  },
  tomorrow_booking: {
    label: "Tomorrow Booking Report",
    filters: ["search"],
    fetch: fetchTomorrowBookingReport,
    columns: tomorrowBookingColumns(),
  },
  expense: {
    label: "Expense Report",
    filters: ["month", "from", "to"],
    fetch: (f) => fetchExpenseReport(f, null),
    columns: expenseColumns(),
  },
  grocery: {
    label: "Grocery Report",
    filters: ["month", "from", "to"],
    fetch: (f) => fetchExpenseReport(f, "grocery"),
    columns: expenseColumns(),
  },
};

const REPORT_HINTS = {
  student:
    "All registered students, with Breakfast/Lunch/Dinner totals for the current month.",
  attendance:
    "Today's meal marking — students with at least one meal booked Yes/Double, same data as Meal Entries.",
  monthly_attendance:
    "Every day of the selected month, Breakfast/Lunch/Dinner status side by side, per student.",
  tomorrow_booking:
    "Tomorrow's bookings — students with at least one meal booked Yes/Double.",
  expense: "All expenses, filterable by month or date range.",
  grocery: "Grocery expenses only, filterable by month or date range.",
};

export async function renderReports(root) {
  root.innerHTML = `
    <div class="card">
      <div class="field">
        <select id="reportType">${Object.entries(REPORT_TYPES)
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`)
          .join("")}</select>
        <label>Report type</label>
      </div>
      <div class="filter-bar">
        <input type="text" id="reportSearch" placeholder="Search…">
        <input type="date" id="reportDate" title="Date">
        <input type="month" id="reportMonth">
        <input type="date" id="reportFrom" title="From date">
        <input type="date" id="reportTo" title="To date">
      </div>
      <p class="text-soft" id="reportHint" style="font-size:12px;margin:8px 0 0;"></p>
      <p class="text-soft" id="reportPeriod" style="font-size:12px;margin:4px 0 0;font-weight:700;"></p>
    </div>
    <div id="reportSummary" class="card-grid"></div>
    <div class="report-toolbar">
      <button class="btn btn-secondary btn-sm" id="exportExcel"><i class="fa-solid fa-file-excel"></i> Excel</button>
      <button class="btn btn-secondary btn-sm" id="exportPdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      <button class="btn btn-secondary btn-sm" id="printBtn"><i class="fa-solid fa-print"></i> Print</button>
    </div>
    <div id="reportOutput"><div class="skeleton" style="height:260px;border-radius:16px;"></div></div>
  `;

  let lastRows = [];
  let lastColumns = [];
  let lastSummary = [];
  let lastPeriod = { label: "", slug: "" };

  function syncFilterVisibility() {
    const type = document.getElementById("reportType").value;
    const active = REPORT_TYPES[type].filters;
    document.getElementById("reportSearch").style.display = active.includes(
      "search",
    )
      ? ""
      : "none";
    document.getElementById("reportDate").style.display = active.includes(
      "date",
    )
      ? ""
      : "none";
    document.getElementById("reportMonth").style.display = active.includes(
      "month",
    )
      ? ""
      : "none";
    document.getElementById("reportFrom").style.display = active.includes(
      "from",
    )
      ? ""
      : "none";
    document.getElementById("reportTo").style.display = active.includes("to")
      ? ""
      : "none";
    if (
      active.includes("date") &&
      !document.getElementById("reportDate").value
    ) {
      document.getElementById("reportDate").value = todayISO();
    }
    if (
      active.includes("month") &&
      !document.getElementById("reportMonth").value
    ) {
      document.getElementById("reportMonth").value = currentMonthYYYYMM();
    }
  }

  async function load() {
    const type = document.getElementById("reportType").value;
    const def = REPORT_TYPES[type];
    syncFilterVisibility();
    const filters = {
      search: document
        .getElementById("reportSearch")
        .value.trim()
        .toLowerCase(),
      date: document.getElementById("reportDate").value,
      month: document.getElementById("reportMonth").value,
      from: document.getElementById("reportFrom").value,
      to: document.getElementById("reportTo").value,
    };
    document.getElementById("reportHint").textContent =
      REPORT_HINTS[type] || "";
    document.getElementById("reportSummary").innerHTML = "";
    document.getElementById("reportOutput").innerHTML =
      `<div class="skeleton" style="height:200px;border-radius:16px;"></div>`;

    const result = await def.fetch(filters);
    lastRows = result.rows;
    lastColumns = result.columns || def.columns;
    lastSummary = result.summary || [];
    lastPeriod = computePeriod(type, filters);

    document.getElementById("reportPeriod").textContent = lastPeriod.label
      ? `Showing: ${lastPeriod.label}`
      : "";
    document.getElementById("reportSummary").innerHTML = lastSummary
      .map((s) => statCard({ label: s.label, value: s.value, icon: s.icon }))
      .join("");
    document.getElementById("reportOutput").innerHTML = renderTable(
      lastColumns,
      lastRows,
      { emptyMessage: "No data for this filter", flat: !!def.flat },
    );
  }

  document.getElementById("reportType").addEventListener("change", load);
  document.getElementById("reportSearch").addEventListener("change", load);
  document.getElementById("reportDate").addEventListener("change", load);
  document.getElementById("reportMonth").addEventListener("change", load);
  document.getElementById("reportFrom").addEventListener("change", load);
  document.getElementById("reportTo").addEventListener("change", load);

  document.getElementById("exportExcel").addEventListener("click", () => {
    const type = document.getElementById("reportType").value;
    if (type === "monthly_attendance") {
      exportMonthlyAttendanceExcel(
        lastRows,
        lastColumns,
        `${type}-${lastPeriod.slug}`,
      );
      return;
    }
    const summaryPairs = lastSummary.map((s) => ({
      label: s.label,
      value: s.value,
    }));
    exportToExcelWithSummary(
      summaryPairs,
      lastRows.map((r) => flattenForExport(lastColumns, r)),
      `${type}-${lastPeriod.slug}`,
    );
  });
  document.getElementById("exportPdf").addEventListener("click", () => {
    const type = document.getElementById("reportType").value;
    const summaryPairs = lastSummary.map((s) => ({
      label: s.label,
      value: s.value,
    }));
    exportToPDFWithSummary(
      summaryPairs,
      lastColumns.map((c) => ({ key: c.key, label: c.label })),
      lastRows.map((r) => flattenForExport(lastColumns, r)),
      `${REPORT_TYPES[type].label} — ${lastPeriod.label}`,
      `${type}-${lastPeriod.slug}`,
    );
  });
  document
    .getElementById("printBtn")
    .addEventListener("click", () => window.print());

  syncFilterVisibility();
  load();
}

function flattenForExport(columns, row) {
  const out = {};
  columns.forEach((c) => {
    const raw = c.render ? c.render(row) : row[c.key];
    if (typeof raw === "string") {
      // turn stacked <br> lines (e.g. Monthly Attendance's "BF: Yes<br>LN: No")
      // into a readable single-line " | " separated value instead of
      // silently concatenating everything together once tags are stripped
      out[c.label] = raw
        .replace(/<br\s*\/?>/gi, " | ")
        .replace(/<[^>]*>/g, "")
        .trim();
    } else {
      out[c.label] = raw;
    }
  });
  return out;
}

// ---- period helpers (drives export title + filename — always the
// SELECTED reporting date/period, never "today" the file was downloaded) --
function currentMonthYYYYMM() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}
function monthYearLabel(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}
function computePeriod(type, f) {
  switch (type) {
    case "student":
      return {
        label: `Current month (${monthYearLabel(currentMonthYYYYMM())})`,
        slug: currentMonthYYYYMM(),
      };
    case "attendance": {
      const d = f.date || todayISO();
      return { label: formatDate(d), slug: d };
    }
    case "monthly_attendance": {
      const m = f.month || currentMonthYYYYMM();
      return { label: monthYearLabel(m), slug: m };
    }
    case "tomorrow_booking": {
      const d = tomorrowISO();
      return { label: formatDate(d), slug: d };
    }
    case "expense":
    case "grocery": {
      if (f.month) return { label: monthYearLabel(f.month), slug: f.month };
      if (f.from || f.to)
        return {
          label: `${f.from ? formatDate(f.from) : "start"} to ${f.to ? formatDate(f.to) : "now"}`,
          slug: `${f.from || "start"}_to_${f.to || "now"}`,
        };
      return { label: "All time", slug: "all-time" };
    }
    default:
      return { label: "", slug: "export" };
  }
}

// ---- 1. Students Report ------------------------------------------------------
function studentColumns() {
  return [
    { key: "name", label: "Student Name" },
    { key: "room_number", label: "Room No" },
    { key: "email", label: "Email" },
    { key: "mobile", label: "Mobile Number" },
    {
      key: "breakfastCount",
      label: "Total Breakfast (This Month)",
      render: (r) => r.breakfastCount ?? 0,
    },
    {
      key: "lunchCount",
      label: "Total Lunch (This Month)",
      render: (r) => r.lunchCount ?? 0,
    },
    {
      key: "dinnerCount",
      label: "Total Dinner (This Month)",
      render: (r) => r.dinnerCount ?? 0,
    },
  ];
}
async function fetchStudentsReport(f) {
  const { data: students } = await supabase
    .from("students")
    .select("*")
    .neq("status", "pending");
  let rows = students || [];
  if (f.search)
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(f.search) ||
        r.room_number.toLowerCase().includes(f.search),
    );

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    .toISOString()
    .slice(0, 10);

  const { data: mealRows } = await supabase
    .from("bookings")
    .select("student_id, meal_type, booking_status, confirmed_status")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  const countsByStudent = {};
  (mealRows || []).forEach((r) => {
    const count = mealCount(effectiveMealStatus(r));
    if (!count) return;
    countsByStudent[r.student_id] = countsByStudent[r.student_id] || {
      breakfast: 0,
      lunch: 0,
      dinner: 0,
    };
    countsByStudent[r.student_id][r.meal_type] += count;
  });

  rows = rows
    .map((r) => ({
      ...r,
      breakfastCount: countsByStudent[r.id]?.breakfast || 0,
      lunchCount: countsByStudent[r.id]?.lunch || 0,
      dinnerCount: countsByStudent[r.id]?.dinner || 0,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows, summary: [] };
}

// ---- 2. Today's Marking Report (formerly "Daily Attendance Report") ------------
// Uses effectiveMealStatus (utils.js) — confirmed_status if the student has
// confirmed something (e.g. via No Food), otherwise falls back to
// booking_status — the SAME logic Meal Entries' "Today's Meal Marking"
// table uses, so the two can never disagree.
function attendanceColumns() {
  return [
    { key: "name", label: "Student Name" },
    { key: "room", label: "Room No" },
    { key: "status", label: "Today's Status" },
    {
      key: "breakfast",
      label: "Breakfast",
      render: (r) =>
        r.breakfast
          ? `<span class="badge badge-${r.breakfast}">${STATUS_LABELS[r.breakfast]}</span>`
          : "—",
    },
    {
      key: "lunch",
      label: "Lunch",
      render: (r) =>
        r.lunch
          ? `<span class="badge badge-${r.lunch}">${STATUS_LABELS[r.lunch]}</span>`
          : "—",
    },
    {
      key: "dinner",
      label: "Dinner",
      render: (r) =>
        r.dinner
          ? `<span class="badge badge-${r.dinner}">${STATUS_LABELS[r.dinner]}</span>`
          : "—",
    },
  ];
}
async function fetchAttendanceReport(f) {
  const date = f.date || todayISO();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "student_id, meal_type, booking_status, confirmed_status, students(name, room_number)",
    )
    .eq("date", date);
  if (error || !data) return { rows: [], summary: [] };

  const byStudent = {};
  data.forEach((r) => {
    byStudent[r.student_id] = byStudent[r.student_id] || {
      name: r.students?.name || "—",
      room: r.students?.room_number || "—",
      breakfast: null,
      lunch: null,
      dinner: null,
    };
    byStudent[r.student_id][r.meal_type] = effectiveMealStatus(r);
  });

  // only students with at least one meal at Yes/Double (by effective
  // status) — matches Meal Entries exactly
  let rows = Object.values(byStudent).filter((r) =>
    MEAL_TYPES.some((m) => ["yes", "double"].includes(r[m])),
  );
  rows = rows.map((r) => {
    const eatenCount = MEAL_TYPES.filter((m) =>
      ["yes", "double"].includes(r[m]),
    ).length;
    const status =
      eatenCount === 3 ? "Full (3/3)" : `Partial (${eatenCount}/3)`;
    return { ...r, status };
  });
  if (f.search)
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(f.search) ||
        r.room.toLowerCase().includes(f.search),
    );
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const totals = { breakfast: 0, lunch: 0, dinner: 0 };
  rows.forEach((r) =>
    MEAL_TYPES.forEach((m) => {
      totals[m] += mealCount(r[m]);
    }),
  );

  return {
    rows,
    summary: [
      {
        label: "Total Breakfast Count",
        value: totals.breakfast,
        icon: "fa-mug-hot",
      },
      { label: "Total Lunch Count", value: totals.lunch, icon: "fa-bowl-food" },
      {
        label: "Total Dinner Count",
        value: totals.dinner,
        icon: "fa-utensils",
      },
    ],
  };
}

// ---- 3. Monthly Attendance Report ------------------------------------------------
// One row per student, one column per day of the selected month. Each day's
// cell stacks all three meals ("BF: Yes / LN: No / DN: No" on export,
// stacked lines on screen). Uses confirmed_status where it's been set,
// falling back to booking_status — for a past day this is normally the
// same value anyway (the nightly sweep copies it), but this way a day
// where a student genuinely changed their meal via No Food still shows
// what actually happened, not just what was originally booked.
function daysInMonth(yyyymm) {
  const [y, m] = yyyymm.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const days = [];
  for (let d = 1; d <= lastDay; d++)
    days.push(
      `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`,
    );
  return days;
}
function formatDayColumnLabel(iso) {
  const d = new Date(iso + "T00:00:00");
  return `${d.toLocaleDateString("en-US", { month: "short" })}-${String(d.getDate()).padStart(2, "0")}`;
}
function dayCellHTML(dayData) {
  const val = (v) => (v ? STATUS_LABELS[v] || v : "—");
  const b = val(dayData?.breakfast),
    l = val(dayData?.lunch),
    dnr = val(dayData?.dinner);
  return `<div class="mono" style="font-size:10px;line-height:1.5;white-space:nowrap;">BF: ${b}<br>LN: ${l}<br>DN: ${dnr}</div>`;
}

/**
 * Monthly Attendance's Excel export uses real grouped columns (a merged
 * parent header cell per date spanning 3 real Breakfast/Lunch/Dinner
 * columns underneath) instead of the generic single-column-per-row export
 * every other report uses — genuinely useful in a spreadsheet (sort/filter
 * per meal type) in a way the stacked-text version isn't. PDF/print still
 * use the generic flattened version; only Excel gets this treatment.
 */
function exportMonthlyAttendanceExcel(rows, columns, filename) {
  const dayColumns = columns.slice(2); // drop Student Name / Room Number
  const val = (v) => (v ? STATUS_LABELS[v] || v : "—");

  const header1 = ["Student Name", "Room Number"];
  const header2 = ["", ""];
  dayColumns.forEach((c) => {
    header1.push(c.label, "", "");
    header2.push("Breakfast", "Lunch", "Dinner");
  });

  const aoa = [header1, header2];
  rows.forEach((r) => {
    const rowArr = [r.name, r.room];
    dayColumns.forEach((c) => {
      const dd = r.dayData[c.key] || {};
      rowArr.push(val(dd.breakfast), val(dd.lunch), val(dd.dinner));
    });
    aoa.push(rowArr);
  });

  const ws = window.XLSX.utils.aoa_to_sheet(aoa);
  const merges = [
    { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, // Student Name spans both header rows
    { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } }, // Room Number spans both header rows
  ];
  dayColumns.forEach((c, i) => {
    const startCol = 2 + i * 3;
    merges.push({ s: { r: 0, c: startCol }, e: { r: 0, c: startCol + 2 } });
  });
  ws["!merges"] = merges;

  const wb = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(wb, ws, "Monthly Attendance");
  window.XLSX.writeFile(wb, `${filename}.xlsx`);
}
async function fetchMonthlyAttendanceReport(f) {
  const month = f.month || currentMonthYYYYMM();
  const days = daysInMonth(month);
  const monthStart = days[0],
    monthEnd = days[days.length - 1];

  const { data: students } = await supabase
    .from("students")
    .select("id, name, room_number")
    .neq("status", "pending");
  let studentRows = students || [];
  if (f.search)
    studentRows = studentRows.filter(
      (s) =>
        s.name.toLowerCase().includes(f.search) ||
        s.room_number.toLowerCase().includes(f.search),
    );
  studentRows.sort((a, b) => a.name.localeCompare(b.name));

  const { data: bookingRows } = await supabase
    .from("bookings")
    .select("student_id, date, meal_type, booking_status, confirmed_status")
    .gte("date", monthStart)
    .lte("date", monthEnd);

  const dataMap = {};
  (bookingRows || []).forEach((r) => {
    dataMap[r.student_id] = dataMap[r.student_id] || {};
    dataMap[r.student_id][r.date] = dataMap[r.student_id][r.date] || {};
    dataMap[r.student_id][r.date][r.meal_type] = effectiveMealStatus(r);
  });

  // date-visibility filter: a day column only appears if AT LEAST ONE
  // student had AT LEAST ONE meal marked Yes/Double that day. Computed
  // across every student regardless of the current name search, so
  // searching for one student doesn't hide days just because THEY didn't
  // eat — a day with any activity anywhere stays visible.
  const visibleDays = days.filter((day) =>
    Object.values(dataMap).some((studentDays) => {
      const dd = studentDays[day];
      return dd && MEAL_TYPES.some((m) => ["yes", "double"].includes(dd[m]));
    }),
  );

  const columns = [
    { key: "name", label: "Student Name" },
    { key: "room", label: "Room Number" },
    ...visibleDays.map((iso) => ({
      key: iso,
      label: formatDayColumnLabel(iso),
      render: (r) => dayCellHTML(r.dayData[iso]),
    })),
  ];

  const rows = studentRows.map((s) => ({
    name: s.name,
    room: s.room_number,
    dayData: dataMap[s.id] || {},
  }));

  return { rows, columns, summary: [] };
}

// ---- 4. Tomorrow Booking Report -------------------------------------------------
function tomorrowBookingColumns() {
  return [
    { key: "name", label: "Student Name" },
    { key: "room", label: "Room No" },
    {
      key: "breakfast",
      label: "Breakfast",
      render: (r) =>
        r.breakfast
          ? `<span class="badge badge-${r.breakfast}">${STATUS_LABELS[r.breakfast]}</span>`
          : "—",
    },
    {
      key: "lunch",
      label: "Lunch",
      render: (r) =>
        r.lunch
          ? `<span class="badge badge-${r.lunch}">${STATUS_LABELS[r.lunch]}</span>`
          : "—",
    },
    {
      key: "dinner",
      label: "Dinner",
      render: (r) =>
        r.dinner
          ? `<span class="badge badge-${r.dinner}">${STATUS_LABELS[r.dinner]}</span>`
          : "—",
    },
  ];
}
async function fetchTomorrowBookingReport(f) {
  const date = tomorrowISO();
  const { data, error } = await supabase
    .from("bookings")
    .select(
      "student_id, meal_type, booking_status, students(name, room_number)",
    )
    .eq("date", date);
  if (error || !data) return { rows: [], summary: [] };

  const byStudent = {};
  data.forEach((r) => {
    byStudent[r.student_id] = byStudent[r.student_id] || {
      name: r.students?.name || "—",
      room: r.students?.room_number || "—",
      breakfast: null,
      lunch: null,
      dinner: null,
    };
    byStudent[r.student_id][r.meal_type] = r.booking_status;
  });

  let rows = Object.values(byStudent).filter((r) =>
    MEAL_TYPES.some((m) => ["yes", "double"].includes(r[m])),
  );
  if (f.search)
    rows = rows.filter(
      (r) =>
        r.name.toLowerCase().includes(f.search) ||
        r.room.toLowerCase().includes(f.search),
    );
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const totals = { breakfast: 0, lunch: 0, dinner: 0 };
  rows.forEach((r) =>
    MEAL_TYPES.forEach((m) => {
      totals[m] += mealCount(r[m]);
    }),
  );

  return {
    rows,
    summary: [
      {
        label: "Total Breakfast Bookings",
        value: totals.breakfast,
        icon: "fa-mug-hot",
      },
      {
        label: "Total Lunch Bookings",
        value: totals.lunch,
        icon: "fa-bowl-food",
      },
      {
        label: "Total Dinner Bookings",
        value: totals.dinner,
        icon: "fa-utensils",
      },
    ],
  };
}

// ---- 5 & 6. Expense / Grocery Report --------------------------------------------
function expenseColumns() {
  return [
    { key: "date", label: "Date", render: (r) => formatDate(r.date) },
    {
      key: "category",
      label: "Category",
      render: (r) => EXPENSE_CATEGORY_LABELS[r.category],
    },
    { key: "amount", label: "Amount", render: (r) => currency(r.amount) },
    { key: "remarks", label: "Remarks", render: (r) => r.remarks || "—" },
  ];
}
async function fetchExpenseReport(f, categoryFilter) {
  let q = supabase
    .from("expenses")
    .select("*")
    .order("date", { ascending: false });
  if (categoryFilter) q = q.eq("category", categoryFilter);
  if (f.month) {
    const [y, m] = f.month.split("-");
    q = q
      .gte("date", `${y}-${m}-01`)
      .lte(
        "date",
        new Date(Number(y), Number(m), 0).toISOString().slice(0, 10),
      );
  }
  if (f.from) q = q.gte("date", f.from);
  if (f.to) q = q.lte("date", f.to);
  const { data } = await q;
  const rows = data || [];
  return { rows, summary: [] };
}
