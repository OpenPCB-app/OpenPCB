() => {
  const S = window.__qaShim;
  const LABELS = ['No designs yet', 'Create your first design', 'No matching designs', 'Select a design', 'No chats yet', 'No pages yet', 'No page selected', 'No tasks yet', 'No libraries installed', 'Loading…', 'Loading...', 'Loading page', 'Loading older messages', 'HTTP 500', 'Internal error', 'Failed', 'designs 0', '0 local', 'Retry', 'New chat', 'Start a conversation', 'What can I help'];
  if (S.mo) S.mo.disconnect();
  const t0 = performance.now();
  S.watch = { t0, events: [], present: {}, shifts: [] };
  let pending = false;
  const check = () => {
    pending = false;
    const txt = document.body.innerText;
    const t = Math.round(performance.now() - t0);
    for (const l of LABELS) {
      const on = txt.includes(l);
      if (!!S.watch.present[l] !== on) { S.watch.present[l] = on; S.watch.events.push({ t, l, on }); }
    }
  };
  S.mo = new MutationObserver(() => { if (!pending) { pending = true; queueMicrotask(check); } });
  S.mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: false });
  check();
  if (!S.lsObs) {
    try {
      S.lsObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
          if (!S.watch) continue;
          S.watch.shifts.push({ t: Math.round(e.startTime - S.watch.t0), v: Math.round(e.value * 1000) / 1000, src: (e.sources || []).slice(0, 3).map((s) => { const n = s.node; const d = n && n.nodeType === 1 ? n.tagName.toLowerCase() + '.' + String(n.className).split(' ').slice(0, 3).join('.') : n ? '#text' : '?'; return d + ' ' + JSON.stringify([s.previousRect.y, s.currentRect.y, s.previousRect.height, s.currentRect.height]); }) });
        }
      });
      S.lsObs.observe({ type: 'layout-shift', buffered: false });
    } catch (e) { S.lsErr = String(e); }
  }
  return 'watching';
}
