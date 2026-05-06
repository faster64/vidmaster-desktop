let container;

function ensureContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  document.body.appendChild(container);
  return container;
}

export function toast({ message, kind = "success", onClick, durationMs = 5000 }) {
  const c = ensureContainer();
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  if (onClick) el.addEventListener("click", onClick);
  c.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
  return el;
}
