() => {
  const W = window;
  const LABELS = ['gpt-4o-mini', 'nemotron', 'No chats yet', 'designs 0', '0 local', 'Select a design', 'No pages yet', 'No tasks yet', 'Loading', 'Cloud', 'OpenRouter'];
  if (W.__vw && W.__vw.mo) W.__vw.mo.disconnect();
  const t0 = performance.now();
  const S = W.__vw = { t0, events: [], present: {}, frames: [] };
  const check = () => {
    const txt = document.body.innerText;
    const t = Math.round(performance.now() - t0);
    for (const l of LABELS) { const on = txt.includes(l); if (!!S.present[l] !== on) { S.present[l] = on; S.events.push({ t, l, on }); } }
  };
  S.mo = new MutationObserver(() => check());
  S.mo.observe(document.body, { subtree: true, childList: true, characterData: true });
  // rAF sampler: record which labels were visible at each painted frame for 1.5 s
  let n = 0;
  const raf = () => { const t = Math.round(performance.now() - t0); const txt = document.body.innerText; S.frames.push({ t, gpt: txt.includes('gpt-4o-mini'), noChats: txt.includes('No chats yet'), zeroLocal: txt.includes('0 local'), noPages: txt.includes('No pages yet') }); if (++n < 90) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  check();
  return 'watching';
}
