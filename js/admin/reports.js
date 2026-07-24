// ============================================================================
// admin/reports.js — reduced to the 6 report types below. Every report
// returns { rows, summary } from its fetch() — summary (an array of
// { label, value } pairs, or empty) is rendered as cards above the table
// AND passed into the export functions, so the downloaded Excel/PDF file
// always shows the exact same figures as the screen, not just the raw rows.
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
    label: "Daily Attendance Report",
    filters: ["search", "date"],
    fetch: fetchAttendanceReport,
    columns: attendanceColumns(),
  },
  fine: {
    label: "Fine Report",
    filters: ["search", "month", "from", "to"],
    fetch: fetchFineReport,
    columns: fineColumns(),
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
    "Today's meal bookings for the selected date — students with at least one meal booked Yes/Double.",
  fine: "Every fine charged, grouped per student. Filter by month or a date range.",
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

    const { rows, summary } = await def.fetch(filters);
    lastRows = rows;
    lastColumns = def.columns;
    lastSummary = summary || [];

    document.getElementById("reportSummary").innerHTML = lastSummary
      .map((s) => statCard({ label: s.label, value: s.value, icon: s.icon }))
      .join("");
    document.getElementById("reportOutput").innerHTML = renderTable(
      def.columns,
      rows,
      { emptyMessage: "No data for this filter" },
    );
  }

  document.getElementById("reportType").addEventListener("change", load);
  document.getElementById("reportSearch").addEventListener("change", load);
  document.getElementById("reportDate").addEventListener("change", load);
  document.getElementById("reportMonth").addEventListener("change", load);
  document.getElementById("reportFrom").addEventListener("change", load);
  document.getElementById("reportTo").addEventListener("change", load);

  document.getElementById("exportExcel").addEventListener("click", () => {
    const summaryPairs = lastSummary.map((s) => ({
      label: s.label,
      value: s.value,
    }));
    exportToExcelWithSummary(
      summaryPairs,
      lastRows.map((r) => flattenForExport(lastColumns, r)),
      `report-${document.getElementById("reportType").value}`,
    );
  });
  document.getElementById("exportPdf").addEventListener("click", () => {
    const summaryPairs = lastSummary.map((s) => ({
      label: s.label,
      value: s.value,
    }));
    exportToPDFWithSummary(
      summaryPairs,
      lastColumns.map((c) => ({ key: c.key, label: c.label })),
      lastRows.map((r) => flattenForExport(lastColumns, r)),
      REPORT_TYPES[document.getElementById("reportType").value].label,
      `report-${document.getElementById("reportType").value}`,
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
    out[c.label] = typeof raw === "string" ? raw.replace(/<[^>]*>/g, "") : raw;
  });
  return out;
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
    .select("student_id, meal_type, confirmed_status")
    .in("confirmed_status", ["yes", "double"])
    .gte("date", monthStart)
    .lte("date", monthEnd);

  const countsByStudent = {};
  (mealRows || []).forEach((r) => {
    countsByStudent[r.student_id] = countsByStudent[r.student_id] || {
      breakfast: 0,
      lunch: 0,
      dinner: 0,
    };
    countsByStudent[r.student_id][r.meal_type]++;
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

// ---- 2. Daily Attendance Report -----------------------------------------------
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

  let rows = Object.values(byStudent)
    .filter((r) => MEAL_TYPES.some((m) => ["yes", "double"].includes(r[m])))
    .map((r) => {
      const bookedCount = MEAL_TYPES.filter((m) =>
        ["yes", "double"].includes(r[m]),
      ).length;
      const status =
        bookedCount === 3
          ? "Full (3/3)"
          : bookedCount === 0
            ? "None (0/3)"
            : `Partial (${bookedCount}/3)`;
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
      if (["yes", "double"].includes(r[m])) totals[m]++;
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

// ---- 3. Fine Report ------------------------------------------------------------
function fineColumns() {
  return [
    { key: "name", label: "Student Name" },
    { key: "room", label: "Room No" },
    { key: "dates", label: "Fine Date(s)" },
    { key: "amount", label: "Fine Amount", render: (r) => currency(r.amount) },
  ];
}
async function fetchFineReport(f) {
  let q = supabase
    .from("fines")
    .select("*, students(name, room_number)")
    .order("date", { ascending: false });
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
  let fines = data || [];
  if (f.search)
    fines = fines.filter((r) =>
      r.students?.name.toLowerCase().includes(f.search),
    );

  const byStudent = {};
  fines.forEach((r) => {
    const key = r.student_id;
    byStudent[key] = byStudent[key] || {
      name: r.students?.name || "—",
      room: r.students?.room_number || "—",
      dates: [],
      amount: 0,
    };
    byStudent[key].dates.push(r.date);
    byStudent[key].amount += Number(r.amount);
  });

  const rows = Object.values(byStudent)
    .map((r) => ({
      ...r,
      dates: r.dates
        .sort()
        .map((d) => formatDate(d))
        .join(", "),
    }))
    .sort((a, b) => b.amount - a.amount);

  const totalFine = rows.reduce((s, r) => s + r.amount, 0);

  return {
    rows,
    summary: [
      {
        label: "Total Fine Amount",
        value: currency(totalFine),
        icon: "fa-coins",
      },
    ],
  };
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
      if (["yes", "double"].includes(r[m])) totals[m]++;
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
