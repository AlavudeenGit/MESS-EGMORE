// ============================================================================
// student/confirmation.js — "today" meal confirmation (Yes / No / No Food / Double)
// Locks after submission or after the configured deadline.
// ============================================================================
import { supabase, MEAL_TYPES, MEAL_LABELS, STATUS_LABELS } from '../config.js';
import { todayISO, getSettings, isPastDeadline, currentTimeHHMM } from '../utils.js';
import { toast } from '../components/Toast.js';

export async function renderConfirmationPanel(container, ctx) {
  const today = todayISO();
  const settings = await getSettings();
  const deadlinePassed = isPastDeadline(settings.confirmation_deadline);

  const { data: rows, error } = await supabase
    .from('bookings').select('*')
    .eq('student_id', ctx.profile.id).eq('date', today);

  if (error) { container.innerHTML = `<p class="text-danger">Could not load today's status.</p>`; return; }

  const byMeal = {};
  MEAL_TYPES.forEach(m => { byMeal[m] = rows.find(r => r.meal_type === m) || null; });

  container.innerHTML = `
    <div class="deadline-banner ${deadlinePassed ? 'is-locked' : ''}">
      <i class="fa-solid ${deadlinePassed ? 'fa-lock' : 'fa-clock'}"></i>
      ${deadlinePassed
        ? `Confirmation deadline (${settings.confirmation_deadline}) has passed for today.`
        : `Confirm before ${settings.confirmation_deadline} today, or a fine may apply.`}
    </div>
    ${MEAL_TYPES.map(meal => mealCardHTML(meal, byMeal[meal], settings, deadlinePassed)).join('')}
  `;

  MEAL_TYPES.forEach(meal => wireMealCard(container, meal, byMeal[meal], settings, deadlinePassed, ctx, today));
}

function mealCardHTML(meal, row, settings, deadlinePassed) {
  const locked = row?.confirmation_locked || row?.cancelled_by_admin;
  const noFoodEnabled = settings[`no_food_enabled_${meal}`] === 'true';
  const current = row?.confirmed_status || null;
  const bookedStatus = row?.booking_status;

  const options = ['yes', 'no', ...(noFoodEnabled ? ['no_food'] : []), 'double'];

  return `
    <div class="card meal-card" data-meal="${meal}">
      <div class="meal-card__head">
        <span class="meal-name">${MEAL_LABELS[meal]}</span>
        ${row?.cancelled_by_admin ? '<span class="badge badge-no">Cancelled</span>'
          : bookedStatus ? `<span class="badge badge-${bookedStatus}">Booked: ${STATUS_LABELS[bookedStatus]}</span>`
          : '<span class="badge badge-locked">Not booked</span>'}
      </div>
      <div class="option-group ${options.length > 3 ? 'option-group--4' : ''}">
        ${options.map(opt => `
          <button class="option-btn ${current === opt ? 'is-selected' : ''}" data-value="${opt}"
            ${locked || deadlinePassed ? 'disabled' : ''}>${STATUS_LABELS[opt]}</button>
        `).join('')}
      </div>
      ${locked ? '<p class="text-soft" style="font-size:12px;margin:0;"><i class="fa-solid fa-lock"></i> Locked</p>' : ''}
    </div>
  `;
}

function wireMealCard(container, meal, row, settings, deadlinePassed, ctx, date) {
  if (row?.confirmation_locked || row?.cancelled_by_admin || deadlinePassed) return;
  const card = container.querySelector(`[data-meal="${meal}"]`);
  if (!card) return;
  card.querySelectorAll('.option-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const value = btn.dataset.value;
      card.querySelectorAll('.option-btn').forEach(b => b.classList.remove('is-selected'));
      btn.classList.add('is-selected');
      card.querySelectorAll('.option-btn').forEach(b => b.disabled = true);

      const payload = {
        student_id: ctx.profile.id, date, meal_type: meal,
        confirmed_status: value, confirmation_locked: true, confirmed_at: new Date().toISOString()
      };
      const { error } = await supabase.from('bookings')
        .upsert(payload, { onConflict: 'student_id,date,meal_type' });

      if (error) {
        toast.error('Could not save confirmation');
        card.querySelectorAll('.option-btn').forEach(b => b.disabled = false);
        return;
      }
      await supabase.rpc('recompute_daily_fine', { p_student_id: ctx.profile.id, p_date: date });
      toast.success(`${MEAL_LABELS[meal]} confirmed as ${STATUS_LABELS[value]}`);
      card.insertAdjacentHTML('beforeend', '<p class="text-soft" style="font-size:12px;margin:8px 0 0;"><i class="fa-solid fa-lock"></i> Locked</p>');
    });
  });
}
