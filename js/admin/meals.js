// ============================================================================
// admin/meals.js — override any student's booking/confirmation for a date,
// plus bulk-cancel a meal (Breakfast/Lunch/Dinner) for Today or Tomorrow.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from '../config.js';
import { todayISO, tomorrowISO, formatDate, debounce } from '../utils.js';
import { renderTable } from '../components/Table.js';
import { openModal, closeModal, confirmDialog } from '../components/Modal.js';
import { toast } from '../components/Toast.js';

export async function renderMeals(root) {
  const today = todayISO();
  root.innerHTML = `
    <div class="card">
      <h3>Bulk Cancel a Meal</h3>
      <p class="text-soft" style="font-size:13px;">Cancelling sets every student's booking for that meal to "No" and locks it.</p>
      <div class="filter-bar">
        <select id="cancelDay"><option value="${today}">Today</option><option value="${tomorrowISO()}">Tomorrow</option></select>
        <select id="cancelMeal">${MEAL_TYPES.map(m => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join('')}</select>
        <button class="btn btn-danger btn-sm" id="cancelMealBtn"><i class="fa-solid fa-ban"></i> Cancel Meal</button>
      </div>
    </div>

    <div class="card">
      <div class="filter-bar">
        <input type="date" id="filterDate" value="${today}">
        <select id="filterMealType"><option value="">All meals</option>${MEAL_TYPES.map(m => `<option value="${m}">${MEAL_LABELS[m]}</option>`).join('')}</select>
        <input type="text" id="filterName" placeholder="Search name or room…">
      </div>
    </div>
    <div id="mealsTable"><div class="skeleton" style="height:220px;border-radius:16px;"></div></div>
  `;

  const state = { date: today, meal: '', search: '' };

  async function load() {
    let query = supabase.from('bookings')
      .select('id, student_id, meal_type, booking_status, confirmed_status, cancelled_by_admin, students(name, room_number)')
      .eq('date', state.date);
    if (state.meal) query = query.eq('meal_type', state.meal);
    const { data, error } = await query;
    if (error) { document.getElementById('mealsTable').innerHTML = `<p class="text-danger">Failed to load entries.</p>`; return; }

    let rows = data || [];
    if (state.search) {
      rows = rows.filter(r => r.students?.name.toLowerCase().includes(state.search) || r.students?.room_number.toLowerCase().includes(state.search));
    }

    const columns = [
      { key: 'name', label: 'Name', render: r => r.students?.name || '—' },
      { key: 'room', label: 'Room', render: r => r.students?.room_number || '—' },
      { key: 'meal', label: 'Meal', render: r => MEAL_LABELS[r.meal_type] },
      { key: 'booked', label: 'Booked', render: r => r.booking_status ? `<span class="badge badge-${r.booking_status}">${STATUS_LABELS[r.booking_status]}</span>` : '—' },
      { key: 'confirmed', label: 'Confirmed', render: r => r.confirmed_status ? `<span class="badge badge-${r.confirmed_status}">${STATUS_LABELS[r.confirmed_status]}</span>` : '—' },
      { key: 'actions', label: 'Actions', render: r => `<button class="btn btn-secondary btn-sm" data-act="edit" data-id="${r.id}">Edit</button>` },
    ];
    document.getElementById('mealsTable').innerHTML = renderTable(columns, rows, { emptyMessage: 'No bookings for this date' });
    document.querySelectorAll('[data-act="edit"]').forEach(b => b.onclick = () => openOverrideModal(rows.find(r => r.id == b.dataset.id), load));
  }

  document.getElementById('filterDate').addEventListener('change', e => { state.date = e.target.value; load(); });
  document.getElementById('filterMealType').addEventListener('change', e => { state.meal = e.target.value; load(); });
  document.getElementById('filterName').addEventListener('input', debounce(e => { state.search = e.target.value.toLowerCase(); load(); }, 250));

  document.getElementById('cancelMealBtn').addEventListener('click', async () => {
    const date = document.getElementById('cancelDay').value;
    const meal = document.getElementById('cancelMeal').value;
    const ok = await confirmDialog(`Cancel ${MEAL_LABELS[meal]} for ${formatDate(date)}? All students' bookings for this meal become "No" and read-only.`, { confirmLabel: 'Cancel Meal' });
    if (!ok) return;

    const { data: activeStudents } = await supabase.from('students').select('id').eq('status', 'active');
    const rows = (activeStudents || []).map(s => ({
      student_id: s.id, date, meal_type: meal,
      booking_status: 'no', booking_locked: true,
      confirmed_status: 'no', confirmation_locked: true, confirmed_at: new Date().toISOString(),
      cancelled_by_admin: true
    }));
    const { error } = await supabase.from('bookings').upsert(rows, { onConflict: 'student_id,date,meal_type' });
    if (error) { toast.error('Could not cancel meal'); return; }
    toast.success(`${MEAL_LABELS[meal]} cancelled for ${formatDate(date)}`);
    load();
  });

  load();
}

function openOverrideModal(row, onSaved) {
  const options = ['yes', 'no', 'double'];
  const confirmOptions = ['yes', 'no', 'no_food', 'double'];
  const body = openModal({
    title: `Override — ${row.students?.name}`,
    bodyHTML: `
      <p class="text-soft">${MEAL_LABELS[row.meal_type]}</p>
      <h4>Booking status</h4>
      <div class="option-group">${options.map(o => `<button class="option-btn ${row.booking_status === o ? 'is-selected' : ''}" data-group="booking" data-value="${o}">${STATUS_LABELS[o]}</button>`).join('')}</div>
      <h4 style="margin-top:16px;">Confirmed status</h4>
      <div class="option-group option-group--4">${confirmOptions.map(o => `<button class="option-btn ${row.confirmed_status === o ? 'is-selected' : ''}" data-group="confirmed" data-value="${o}">${STATUS_LABELS[o]}</button>`).join('')}</div>
      <button class="btn btn-primary btn-block" id="saveOverride" style="margin-top:20px;">Save Override</button>
    `
  });

  let newBooking = row.booking_status, newConfirmed = row.confirmed_status;
  body.querySelectorAll('[data-group="booking"]').forEach(b => b.onclick = () => {
    body.querySelectorAll('[data-group="booking"]').forEach(x => x.classList.remove('is-selected'));
    b.classList.add('is-selected'); newBooking = b.dataset.value;
  });
  body.querySelectorAll('[data-group="confirmed"]').forEach(b => b.onclick = () => {
    body.querySelectorAll('[data-group="confirmed"]').forEach(x => x.classList.remove('is-selected'));
    b.classList.add('is-selected'); newConfirmed = b.dataset.value;
  });

  body.querySelector('#saveOverride').onclick = async () => {
    const { error } = await supabase.from('bookings').update({
      booking_status: newBooking, confirmed_status: newConfirmed
    }).eq('id', row.id);
    if (error) { toast.error('Could not save override'); return; }
    await supabase.rpc('recompute_daily_fine', { p_student_id: row.student_id, p_date: (await supabase.from('bookings').select('date').eq('id', row.id).single()).data.date });
    toast.success('Override saved');
    closeModal();
    onSaved();
  };
}
