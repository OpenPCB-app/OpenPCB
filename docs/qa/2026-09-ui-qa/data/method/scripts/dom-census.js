() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth; };
  const path = (el) => { const p = []; let e = el; for (let i = 0; e && i < 4; i++, e = e.parentElement) { let s = e.tagName.toLowerCase(); if (e.id) s += '#' + e.id; const tid = e.getAttribute && e.getAttribute('data-testid'); if (tid) s += `[data-testid=${tid}]`; const al = e.getAttribute && e.getAttribute('aria-label'); if (al) s += `[aria-label="${al.slice(0,30)}"]`; p.unshift(s); } return p.join('>'); };
  const name = (el) => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || (el.getAttribute('aria-labelledby') ? 'labelledby' : '') || (el.querySelector && el.querySelector('img[alt]') ? 'img-alt' : '');
  const smallText = []; const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (!vis(el) || el.closest('canvas')) continue;
    const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!own) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 10 && !seen.has(el)) { seen.add(el); smallText.push({ fs, text: el.textContent.trim().slice(0, 40), path: path(el) }); }
  }
  const heights = {}; const ctl = [];
  for (const el of document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]):not([type=range]):not([type=file]), select, textarea')) {
    if (!vis(el)) continue; const h = Math.round(el.getBoundingClientRect().height); const k = el.tagName.toLowerCase() + ':' + h; heights[k] = (heights[k] || 0) + 1; if (el.tagName !== 'TEXTAREA') ctl.push({ h, path: path(el) });
  }
  const nameless = [];
  for (const el of document.querySelectorAll('button, [role=button], a[href], [role=tab], [role=menuitem], [role=switch], input, select, textarea')) {
    if (!vis(el)) continue;
    if (['INPUT','SELECT','TEXTAREA'].includes(el.tagName)) { const id = el.id; const lab = id && document.querySelector(`label[for="${CSS.escape(id)}"]`); if (el.getAttribute('aria-label') || el.getAttribute('placeholder') || lab || el.closest('label') || el.getAttribute('aria-labelledby') || el.type === 'hidden') continue; nameless.push(path(el)); continue; }
    if (!name(el)) nameless.push(path(el));
  }
  const comingSoon = [...document.querySelectorAll('[title], [aria-label]')].filter(e => vis(e) && /coming soon/i.test((e.getAttribute('title') || '') + (e.getAttribute('aria-label') || ''))).map(path);
  const textSoon = [...document.querySelectorAll('body *')].filter(e => vis(e) && e.children.length === 0 && /coming soon/i.test(e.textContent)).map(path);
  const colors = {};
  for (const el of document.querySelectorAll('body *')) { if (!vis(el) || el.closest('canvas')) continue; const cs = getComputedStyle(el); for (const [k, v] of [['bg', cs.backgroundColor], ['fg', cs.color], ['bd', cs.borderTopWidth !== '0px' ? cs.borderTopColor : null]]) { if (!v || v === 'rgba(0, 0, 0, 0)') continue; const key = k + ' ' + v; colors[key] = (colors[key] || 0) + 1; } }
  const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  return JSON.stringify({ url: location.href, theme, vw: innerWidth, vh: innerHeight, title: document.title, smallText: smallText.slice(0, 60), smallTextCount: smallText.length, controlHeights: heights, oddControls: ctl.filter(c => c.h !== 22 && c.h !== 20).slice(0, 40), nameless: nameless.slice(0, 60), namelessCount: nameless.length, comingSoon: [...comingSoon, ...textSoon].slice(0, 20), topColors: Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 40), dialogCalls: window.__qaDialogCalls || null });
}
