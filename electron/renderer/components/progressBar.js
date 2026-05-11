export function progressBar(percent) {
  const p = Math.max(0, Math.min(100, Math.round(percent || 0)));
  return `<div class="progress" style="flex:1;max-width:240px"><div class="bar" style="width:${p}%"></div></div><span style="min-width:42px;text-align:right">${p}%</span>`;
}
