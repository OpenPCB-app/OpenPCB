() => {
  const W = window;
  const t0 = performance.now();
  const S = W.__vw2 = { t0, frames: [] };
  let n = 0;
  const q = () => { const h = document.querySelector('header h1'); const hdr = h ? h.parentElement.innerText.split('\n').slice(0,2).join('|') : null; const sb = [...document.querySelectorAll('*')].find(e => e.children.length===0 && /^designs \d+$/.test(e.textContent.trim())); return { hdr, sb: sb ? sb.textContent.trim() : null, spin: !!document.querySelector('.animate-spin') }; };
  const raf = () => { S.frames.push({ t: Math.round(performance.now() - t0), ...q() }); if (++n < 120) requestAnimationFrame(raf); };
  requestAnimationFrame(raf);
  return 'ok';
}
