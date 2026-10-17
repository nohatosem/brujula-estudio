// Brújula 4 · tema claro/oscuro (auto sigue al sistema).
const media = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
let current = 'auto';

export function applyTheme(theme = 'auto') {
  current = ['light', 'dark'].includes(theme) ? theme : 'auto';
  const root = document.documentElement;
  if (current === 'auto') delete root.dataset.theme; else root.dataset.theme = current;
  const dark = current === 'dark' || (current === 'auto' && media?.matches);
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', dark ? '#101614' : '#F5F6F1'));
}
export const currentTheme = () => current;
media?.addEventListener?.('change', () => { if (current === 'auto') applyTheme('auto'); });
