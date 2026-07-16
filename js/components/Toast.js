// ============================================================================
// Toast.js — lightweight toast notifications
// Usage: import { toast } from './components/Toast.js'; toast.success('Saved');
// ============================================================================

function ensureStack() {
  let stack = document.querySelector(".toast-stack");
  if (!stack) {
    stack = document.createElement("div");
    stack.className = "toast-stack";
    document.body.appendChild(stack);
  }
  return stack;
}

function show(message, type = "info", duration = 3200) {
  const stack = ensureStack();
  const el = document.createElement("div");
  el.className = `toast toast--${type}`;
  const icon =
    type === "success"
      ? "fa-circle-check"
      : type === "error"
        ? "fa-circle-exclamation"
        : "fa-circle-info";
  el.innerHTML = `<i class="fa-solid ${icon}"></i><span>${message}</span>`;
  stack.appendChild(el);
  requestAnimationFrame(() => el.classList.add("is-visible"));
  setTimeout(() => {
    el.classList.remove("is-visible");
    setTimeout(() => el.remove(), 250);
  }, duration);
}

export const toast = {
  success: (msg, d) => show(msg, "success", d),
  error: (msg, d) => show(msg, "error", d),
  info: (msg, d) => show(msg, "info", d),
};
