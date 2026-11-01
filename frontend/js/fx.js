// Visual effect only: dashboard numbers count up once. The app works without this file.
(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const countUp = el => {
    const n = Number(el.textContent.replace(/,/g, ""));
    if (!Number.isInteger(n) || n < 1) return;
    const t0 = performance.now();
    requestAnimationFrame(function f(t) { const k = Math.min(1, (t - t0) / 900); el.textContent = Math.round(n * (1 - (1 - k) ** 3)).toLocaleString(); if (k < 1) requestAnimationFrame(f); });
  };
  const dash = document.getElementById("v-dashboard");
  if (dash) new MutationObserver(() => dash.querySelectorAll(".stat b:not([data-c])").forEach(b => { b.dataset.c = 1; countUp(b); })).observe(dash, { childList: true });
})();
