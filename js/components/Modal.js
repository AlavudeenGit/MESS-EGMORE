// ============================================================================
// Modal.js — slide-up-on-mobile / centered-on-desktop dialog
// Usage:
//   import { openModal, closeModal } from './components/Modal.js';
//   openModal({ title: 'Edit Student', bodyHTML: '<div>...</div>', onOpen: (root)=>{} });
// ============================================================================

let overlayEl = null;

function ensureOverlay() {
  if (overlayEl) return overlayEl;
  overlayEl = document.createElement("div");
  overlayEl.className = "modal-overlay";
  overlayEl.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal__header">
        <h3 class="modal__title"></h3>
        <button class="icon-btn modal__close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="modal__body"></div>
    </div>`;
  document.body.appendChild(overlayEl);
  overlayEl.addEventListener("click", (e) => {
    if (e.target === overlayEl) closeModal();
  });
  overlayEl
    .querySelector(".modal__close")
    .addEventListener("click", closeModal);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });
  return overlayEl;
}

export function openModal({ title = "", bodyHTML = "", onOpen = null }) {
  const overlay = ensureOverlay();
  overlay.querySelector(".modal__title").textContent = title;
  const body = overlay.querySelector(".modal__body");
  body.innerHTML = bodyHTML;
  overlay.classList.add("is-open");
  document.body.style.overflow = "hidden";
  if (onOpen) onOpen(body);
  return body;
}

export function closeModal() {
  if (!overlayEl) return;
  overlayEl.classList.remove("is-open");
  document.body.style.overflow = "";
}

/** Convenience: confirm dialog returning a Promise<boolean> */
export function confirmDialog(
  message,
  { confirmLabel = "Confirm", danger = true } = {},
) {
  return new Promise((resolve) => {
    const body = openModal({
      title: "Please confirm",
      bodyHTML: `
        <p>${message}</p>
        <div style="display:flex; gap:8px; margin-top:16px;">
          <button class="btn btn-secondary btn-block" data-act="cancel">Cancel</button>
          <button class="btn ${danger ? "btn-danger" : "btn-primary"} btn-block" data-act="ok">${confirmLabel}</button>
        </div>`,
    });
    body.querySelector('[data-act="cancel"]').onclick = () => {
      closeModal();
      resolve(false);
    };
    body.querySelector('[data-act="ok"]').onclick = () => {
      closeModal();
      resolve(true);
    };
  });
}
