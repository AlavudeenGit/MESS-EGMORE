// ============================================================================
// admin/reports.js — one generic report builder that covers every report
// type in the spec: Student, Active/Inactive, Fine, Breakfast/Lunch/Dinner,
// Booking, Confirmation, Monthly Payment, Grocery, Expense, Revenue,
// Profit/Loss. Each report type defines its own `fetch(filters)` and
// `columns`; the surrounding filter bar, search, and export buttons are shared.
// ============================================================================
import { supabase, MEAL_LABELS, STATUS_LABELS, EXPENSE_CATEGORY_LABELS } from '../config.js';
import { formatDate, currency, exportToExcel, exportToPDF, todayISO } from '../utils.js';
import { renderTable } from '../components/Table.js';

const REPORT_TYPES = {
  student: { label: 'Student Report', fetch: fetchStudents, columns: studentColumns() },
  active_inactive: { label: 'Active / Inactive Report', fetch: fetchStudents, columns: studentColumns() },
  fine: { label: 'Fine Report', fetch: fetchFines, columns: fineColumns() },
  breakfast: { label: 'Breakfast Report', fetch: (f) => fetchMealReport(f, 'breakfast'), columns: mealColumns() },
  lunch: { label: 'Lunch Report', fetch: (f) => fetchMealReport(f, 'lunch'), columns: mealColumns() },
  dinner: { label: 'Dinner Report', fetch: (f) => fetchMealReport(f, 'dinner'), columns: mealColumns() },
  booking: { label: 'Booking Report', fetch: fetchBookingReport, columns: bookingColumns() },
  confirmation: { label: 'Confirmation Report', fetch: fetchConfirmationReport, columns: confirmationColumns() },
  payment: { label: 'Monthly Payment Report', fetch: fetchPaymentReport, columns: paymentColumns() },
  grocery: { label: 'Grocery Report', fetch: (f) => fetchExpenseReport(f, 'grocery'), columns: expenseColumns() },
  expense: { label: 'Expense Report', fetch: (f) => fetchExpenseReport(f, null), columns: expenseColumns() },
  revenue: { label: 'Revenue Report', fetch: fetchRevenueReport, columns: revenueColumns() },
  profit_loss: { label: 'Profit / Loss Report', fetch: fetchProfitLossReport, columns: profitLossColumns() },
};

export async function renderReports(root) {
  root.innerHTML = `
    <div class="card">
      <div class="field">
        <select id="reportType">${Object.entries(REPORT_TYPES).map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        <label>Report type</label>
      </div>
      <div class="filter-bar">
        <input type="text" id="reportSearch" placeholder="Search…">
        <input type="month" id="reportMonth">
        <input type="date" id="reportFrom" title="From date">
        <input type="date" id="reportTo" title="To date">
      </div>
    </div>
    <div class="report-toolbar">
      <button class="btn btn-secondary btn-sm" id="exportExcel"><i class="fa-solid fa-file-excel"></i> Excel</button>
      <button class="btn btn-secondary btn-sm" id="exportPdf"><i class="fa-solid fa-file-pdf"></i> PDF</button>
      <button class="btn btn-secondary btn-sm" id="printBtn"><i class="fa-solid fa-print"></i> Print</button>
    </div>
    <div id="reportOutput"><div class="skeleton" style="height:260px;border-radius:16px;"></div></div>
  `;

  let lastRows = [];
  let lastColumns = [];

  async function load() {
    const type = document.getElementById('reportType').value;
    const def = REPORT_TYPES[type];
    const filters = {
      search: document.getElementById('reportSearch').value.trim().toLowerCase(),
      month: document.getElementById('reportMonth').value,
      from: document.getElementById('reportFrom').value,
      to: document.getElementById('reportTo').value,
      statusFilter: type === 'active_inactive' ? true : false,
    };
    document.getElementById('reportOutput').innerHTML = `<div class="skeleton" style="height:200px;border-radius:16px;"></div>`;
    const rows = await def.fetch(filters);
    lastRows = rows;
    lastColumns = def.columns;
    document.getElementById('reportOutput').innerHTML = `<div id="reportTableWrap">${renderTable(def.columns, rows, { emptyMessage: 'No data for this filter' })}</div>`;
  }

  document.getElementById('reportType').addEventListener('change', load);
  document.getElementById('reportSearch').addEventListener('change', load);
  document.getElementById('reportMonth').addEventListener('change', load);
  document.getElementById('reportFrom').addEventListener('change', load);
  document.getElementById('reportTo').addEventListener('change', load);

  document.getElementById('exportExcel').addEventListener('click', () => {
    exportToExcel(lastRows.map(r => flattenForExport(lastColumns, r)), `report-${document.getElementById('reportType').value}`);
  });
  document.getElementById('exportPdf').addEventListener('click', () => {
    exportToPDF(
      lastColumns.map(c => ({ key: c.key, label: c.label })),
      lastRows.map(r => flattenForExport(lastColumns, r)),
      REPORT_TYPES[document.getElementById('reportType').value].label,
      `report-${document.getElementById('reportType').value}`
    );
  });
  document.getElementById('printBtn').addEventListener('click', () => window.print());

  load();
}

function flattenForExport(columns, row) {
  const out = {};
  columns.forEach(c => {
    const raw = c.render ? c.render(row) : row[c.key];
    out[c.label] = typeof raw === 'string' ? raw.replace(/<[^>]*>/g, '') : raw;
  });
  return out;
}

// ---- report definitions -----------------------------------------------------

function studentColumns() {
  return [
    { key: 'name', label: 'Name' },
    { key: 'room_number', label: 'Room' },
    { key: 'mobile', label: 'Mobile' },
    { key: 'email', label: 'Email' },
    { key: 'status', label: 'Status', render: r => r.status },
    { key: 'joined_at', label: 'Joined', render: r => formatDate(r.joined_at) },
  ];
}
async function fetchStudents(f) {
  let q = supabase.from('students').select('*').neq('status', 'pending');
  const { data } = await q;
  let rows = data || [];
  if (f.search) rows = rows.filter(r => r.name.toLowerCase().includes(f.search) || r.room_number.toLowerCase().includes(f.search));
  return rows;
}

function fineColumns() {
  return [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'name', label: 'Student', render: r => r.students?.name || '—' },
    { key: 'room', label: 'Room', render: r => r.students?.room_number || '—' },
    { key: 'reason', label: 'Reason', render: r => r.reason === 'mismatch' ? 'Booking/confirmation mismatch' : r.reason === 'no_confirmation' ? 'No confirmation submitted' : 'Manual' },
    { key: 'amount', label: 'Amount', render: r => currency(r.amount) },
  ];
}
async function fetchFines(f) {
  let q = supabase.from('fines').select('*, students(name, room_number)').order('date', { ascending: false });
  if (f.month) { const [y, m] = f.month.split('-'); q = q.gte('date', `${y}-${m}-01`).lte('date', new Date(Number(y), Number(m), 0).toISOString().slice(0, 10)); }
  if (f.from) q = q.gte('date', f.from);
  if (f.to) q = q.lte('date', f.to);
  const { data } = await q;
  let rows = data || [];
  if (f.search) rows = rows.filter(r => r.students?.name.toLowerCase().includes(f.search));
  return rows;
}

function mealColumns() {
  return [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'name', label: 'Student', render: r => r.students?.name || '—' },
    { key: 'room', label: 'Room', render: r => r.students?.room_number || '—' },
    { key: 'booking_status', label: 'Booked', render: r => r.booking_status ? STATUS_LABELS[r.booking_status] : '—' },
    { key: 'confirmed_status', label: 'Confirmed', render: r => r.confirmed_status ? STATUS_LABELS[r.confirmed_status] : '—' },
    { key: 'fine_amount', label: "Day's Fine", render: r => currency(r.fine_amount) },
  ];
}
async function fetchMealReport(f, mealType) {
  let q = supabase.from('bookings').select('*, students(name, room_number)').eq('meal_type', mealType).order('date', { ascending: false });
  applyDateFilters(q, f);
  const { data } = await applyAndRun(q, f);
  let rows = data || [];
  if (f.search) rows = rows.filter(r => r.students?.name.toLowerCase().includes(f.search));
  return rows;
}

function bookingColumns() {
  return [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'name', label: 'Student', render: r => r.students?.name || '—' },
    { key: 'meal_type', label: 'Meal', render: r => MEAL_LABELS[r.meal_type] },
    { key: 'booking_status', label: 'Booked', render: r => r.booking_status ? STATUS_LABELS[r.booking_status] : '—' },
  ];
}
async function fetchBookingReport(f) {
  let q = supabase.from('bookings').select('*, students(name, room_number)').not('booking_status', 'is', null).order('date', { ascending: false });
  const { data } = await applyAndRun(q, f);
  let rows = data || [];
  if (f.search) rows = rows.filter(r => r.students?.name.toLowerCase().includes(f.search));
  return rows;
}

function confirmationColumns() {
  return [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'name', label: 'Student', render: r => r.students?.name || '—' },
    { key: 'meal_type', label: 'Meal', render: r => MEAL_LABELS[r.meal_type] },
    { key: 'confirmed_status', label: 'Confirmed', render: r => r.confirmed_status ? STATUS_LABELS[r.confirmed_status] : '—' },
  ];
}
async function fetchConfirmationReport(f) {
  let q = supabase.from('bookings').select('*, students(name, room_number)').not('confirmed_status', 'is', null).order('date', { ascending: false });
  const { data } = await applyAndRun(q, f);
  let rows = data || [];
  if (f.search) rows = rows.filter(r => r.students?.name.toLowerCase().includes(f.search));
  return rows;
}

function paymentColumns() {
  return [
    { key: 'month_year', label: 'Month', render: r => formatDate(r.month_year, { day: undefined }) },
    { key: 'name', label: 'Student', render: r => r.students?.name || '—' },
    { key: 'mess_amount', label: 'Mess Amount', render: r => currency(r.mess_amount) },
    { key: 'paid_amount', label: 'Paid', render: r => currency(r.paid_amount) },
    { key: 'status', label: 'Status', render: r => r.status },
  ];
}
async function fetchPaymentReport(f) {
  let q = supabase.from('payments').select('*, students(name, room_number)').order('month_year', { ascending: false });
  if (f.month) q = q.eq('month_year', `${f.month}-01`);
  const { data } = await q;
  let rows = data || [];
  if (f.search) rows = rows.filter(r => r.students?.name.toLowerCase().includes(f.search));
  return rows;
}

function expenseColumns() {
  return [
    { key: 'date', label: 'Date', render: r => formatDate(r.date) },
    { key: 'category', label: 'Category', render: r => EXPENSE_CATEGORY_LABELS[r.category] },
    { key: 'amount', label: 'Amount', render: r => currency(r.amount) },
    { key: 'remarks', label: 'Remarks', render: r => r.remarks || '—' },
  ];
}
async function fetchExpenseReport(f, categoryFilter) {
  let q = supabase.from('expenses').select('*').order('date', { ascending: false });
  if (categoryFilter) q = q.eq('category', categoryFilter);
  const { data } = await applyAndRun(q, f);
  return data || [];
}

function revenueColumns() {
  return [
    { key: 'month', label: 'Month' },
    { key: 'payments', label: 'Payments Collected', render: r => currency(r.payments) },
    { key: 'fines', label: 'Fine Collection', render: r => currency(r.fines) },
    { key: 'total', label: 'Total Revenue', render: r => currency(r.total) },
  ];
}
async function fetchRevenueReport(f) {
  const months = last6Months();
  const rows = [];
  for (const m of months) {
    const { data: pay } = await supabase.from('payments').select('paid_amount').eq('month_year', `${m}-01`);
    const { data: fines } = await supabase.from('fines').select('amount').gte('date', `${m}-01`).lte('date', monthEnd(m));
    const payments = (pay || []).reduce((s, p) => s + Number(p.paid_amount), 0);
    const fineTotal = (fines || []).reduce((s, x) => s + Number(x.amount), 0);
    rows.push({ month: m, payments, fines: fineTotal, total: payments + fineTotal });
  }
  return rows;
}

function profitLossColumns() {
  return [
    { key: 'month', label: 'Month' },
    { key: 'revenue', label: 'Revenue', render: r => currency(r.revenue) },
    { key: 'expenses', label: 'Expenses', render: r => currency(r.expenses) },
    { key: 'profit', label: 'Profit / Loss', render: r => currency(r.profit) },
  ];
}
async function fetchProfitLossReport(f) {
  const months = last6Months();
  const rows = [];
  for (const m of months) {
    const { data: pay } = await supabase.from('payments').select('paid_amount').eq('month_year', `${m}-01`);
    const { data: fines } = await supabase.from('fines').select('amount').gte('date', `${m}-01`).lte('date', monthEnd(m));
    const { data: exp } = await supabase.from('expenses').select('amount').gte('date', `${m}-01`).lte('date', monthEnd(m));
    const revenue = (pay || []).reduce((s, p) => s + Number(p.paid_amount), 0) + (fines || []).reduce((s, x) => s + Number(x.amount), 0);
    const expenses = (exp || []).reduce((s, e) => s + Number(e.amount), 0);
    rows.push({ month: m, revenue, expenses, profit: revenue - expenses });
  }
  return rows;
}

// ---- shared helpers -----------------------------------------------------------
function applyAndRun(query, f) {
  if (f.month) { const [y, m] = f.month.split('-'); query = query.gte('date', `${y}-${m}-01`).lte('date', new Date(Number(y), Number(m), 0).toISOString().slice(0, 10)); }
  if (f.from) query = query.gte('date', f.from);
  if (f.to) query = query.lte('date', f.to);
  return query;
}
function applyDateFilters() { /* kept for readability; logic lives in applyAndRun */ }
function last6Months() {
  const out = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}
function monthEnd(ym) {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m), 0).toISOString().slice(0, 10);
}
