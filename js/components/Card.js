// ============================================================================
// Card.js — summary stat cards + the "thali ring" signature status widget
// ============================================================================

/** returns HTML for a single summary stat card */
export function statCard({ label, value, diff = null, icon = null }) {
  const diffHTML = diff !== null
    ? `<span class="stat-diff ${diff >= 0 ? 'up' : 'down'}"><i class="fa-solid fa-arrow-${diff >= 0 ? 'up' : 'down'}"></i> ${Math.abs(diff)}%</span>`
    : '';
  return `
    <div class="card">
      <div class="card__label">${icon ? `<i class="fa-solid ${icon}"></i> ` : ''}${label}</div>
      <div class="card__value">${value}</div>
      ${diffHTML}
    </div>`;
}

const RING_COLORS = {
  yes: 'var(--color-primary)',
  no: 'var(--color-danger)',
  double: 'var(--color-double)',
  no_food: 'var(--color-no-food)',
  pending: 'var(--color-border)'
};

/**
 * Renders the signature "thali ring": a plate divided into 3 arcs
 * (breakfast / lunch / dinner), each colored by that meal's status.
 * statuses: { breakfast: 'yes'|'no'|'double'|'no_food'|'pending', lunch: ..., dinner: ... }
 */
export function thaliRing(statuses, { size = 120, stroke = 16 } = {}) {
  const meals = ['breakfast', 'lunch', 'dinner'];
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const segLen = circumference / 3;
  const gap = 6;

  let arcs = '';
  meals.forEach((meal, i) => {
    const color = RING_COLORS[statuses[meal] || 'pending'];
    const offset = i * segLen;
    arcs += `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${color}"
      stroke-width="${stroke}" stroke-linecap="round"
      stroke-dasharray="${segLen - gap} ${circumference - (segLen - gap)}"
      stroke-dashoffset="${-offset}"
      transform="rotate(-90 ${c} ${c})" />`;
  });

  const legend = meals.map(meal => {
    const status = statuses[meal] || 'pending';
    const label = status === 'pending' ? 'Not set' :
      status === 'no_food' ? 'No Food' : status.charAt(0).toUpperCase() + status.slice(1);
    return `<div class="thali-ring__row">
      <span class="thali-ring__dot" style="background:${RING_COLORS[status]}"></span>
      ${meal.charAt(0).toUpperCase() + meal.slice(1)} · ${label}
    </div>`;
  }).join('');

  return `
    <div class="thali-ring">
      <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
        <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="${stroke}" />
        ${arcs}
      </svg>
      <div class="thali-ring__legend">${legend}</div>
    </div>`;
}
