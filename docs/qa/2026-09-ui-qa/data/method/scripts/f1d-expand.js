() => {
  const find = (t) => [...document.querySelectorAll('[draggable=true]')].find(r => { const s = r.querySelector('span.truncate'); return s && s.textContent.startsWith(t); });
  for (const t of ['000','020','021','022','023','024','025','026']) {
    const row = find(t); if (!row) return 'missing ' + t;
    const b = row.querySelector('button');
    if (b.querySelector('.lucide-chevron-right')) { b.click(); return 'expanded ' + t; }
  }
  return 'all expanded';
}
