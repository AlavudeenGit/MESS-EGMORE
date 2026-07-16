// ============================================================================
// student/booking.js — "tomorrow" meal booking (Yes / No / Double), plus the
// combined "Mark Food" view that tabs between Today (confirmation.js) and
// Tomorrow (this file).
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from '../config.js';
import { tomorrowISO, getSettings, isWithinWindow } from '../utils.js';
import { toast } from '../components/Toast.js';
import { renderConfirmationPanel } from './confirmation.js';

export async function renderMarkFood(root, ctx) {
  root.innerHTML = `
    <div class="chip-row">
      <button class="chip is-active" data-tab="today">Today's Confirmation</button>
      <button class="chip" data-tab="tomorrow">Tomorrow's Booking</button>
    </div>
    <div id="markFoodPanel"></div>
  `;
  const panel = root.querySelector('#markFoodPanel');
  const chips = [...root.querySelectorAll('.chip')];

  async function showTab(tab) {
    chips.forEach(c => c.classList.toggle('is-active', c.dataset.tab === tab));
    panel.innerHTML = `<div class="skeleton" style="height:100px;border-radius:16px;"></div>`;
    if (tab === 'today') await renderConfirmationPanel(panel, ctx);
    else await renderBookingPanel(panel, ctx);
  }

  chips.forEach(chip => chip.addEventListener('click', () => showTab(chip.dataset.tab)));
  showTab('today');
}

async function renderBookingPanel(container, ctx) {
  const tomorrow = tomorrowISO();
  const settings = await getSettings();
  const windowOpen = isWithinWindow(settings.booking_open_time, settings.booking_close_time);

  const { data: rows, error } = await supabase
    .from('bookings').select('*')
    .eq('student_id', ctx.profile.id).eq('date', tomorrow);

  if (error) { container.innerHTML = `<p class="text-danger">Could not load tomorrow's booking.</p>`; return; }

  const byMeal = {};
  MEAL_TYPES.forEach(m => { byMeal[m] = rows.find(r => r.meal_type === m) || null; });

  container.innerHTML = `
    <div class="deadline-banner ${windowOpen ? '' : 'is-locked'}">
      <i class="fa-solid ${windowOpen ? 'fa-clock' : 'fa-lock'}"></i>
      ${windowOpen
        ? `Booking window open until ${settings.booking_close_time} tonight.`
        : `Booking window (${settings.booking_open_time}–${settings.booking_close_time}) is currently closed.`}
    </div>
    ${MEAL_TYPES.map(meal => bookingCardHTML(meal, byMeal[meal], windowOpen)).join('')}
  `;

  MEAL_TYPES.forEach(meal => wireBookingCard(container, meal, byMeal[meal], windowOpen, ctx, tomorrow));
}

function bookingCardHTML(meal, row, windowOpen) {
  const locked = row?.booking_locked || row?.cancelled_by_admin;
  const current = row?.booking_status || null;
  return `
    <div class="card meal-card" data-meal="${meal}">
      <div class="meal-card__head">
        <span class="meal-name">${MEAL_LABELS[meal]}</span>
        ${row?.cancelled_by_admin ? '<span class="badge badge-no">Cancelled by admin</span>' : ''}
      </div>
      <div class="option-group">
        ${['yes', 'no', 'double'].map(opt => `
          <button class="option-btn ${current === opt ? 'is-selected' : ''}" data-value="${opt}"
            ${locked || !windowOpen ? 'disabled' : ''}>${STATUS_LABELS[opt]}</button>
        `).join('')}
      </div>
      ${locked ? '<p class="text-soft" style="font-size:12px;margin:0;"><i class="fa-solid fa-lock"></i> Locked</p>' : ''}
    </div>
  `;
}

function wireBookingCard(container, meal, row, windowOpen, ctx, date) {
  if (row?.booking_locked || row?.cancelled_by_admin || !windowOpen) return;
  const card = container.querySelector(`[data-meal="${meal}"]`);
  if (!card) return;
  card.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.value;
      card.querySelectorAll('.option-btn').forEach(b => { b.classList.remove('is-selected'); b.disabled = true; });
      btn.classList.add('is-selected');

      const payload = {
        student_id: ctx.profile.id, date, meal_type: meal,
        booking_status: value, booked_at: new Date().toISOString()
      };
      const { error } = await supabase.from('bookings')
        .upsert(payload, { onConflict: 'student_id,date,meal_type' });

      if (error) {
        toast.error('Could not save booking');
        card.querySelectorAll('.option-btn').forEach(b => b.disabled = false);
        return;
      }
      toast.success(`${MEAL_LABELS[meal]} booked as ${STATUS_LABELS[value]} for tomorrow`);
    });
  });
}
