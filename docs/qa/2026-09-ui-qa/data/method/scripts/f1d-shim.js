() => {
  const W = window;
  if (!W.__qaOrigFetch) W.__qaOrigFetch = W.fetch.bind(W);
  const S = (W.__qaShim = W.__qaShim || {
    delay: 0,
    mock: { home: false, chats: false, docs: false },
    fail: [],
    log: [],
    blocked: [],
    longtasks: [],
    marks: {},
  });
  // Long-task observer (main-thread blocking evidence).
  if (!S.ltObs && W.PerformanceObserver) {
    try {
      S.ltObs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) S.longtasks.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) });
      });
      S.ltObs.observe({ type: 'longtask', buffered: true });
    } catch (e) { S.ltErr = String(e); }
  }
  // Deterministic PRNG.
  let seed = 1234567;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const WORDS = ['Dual', 'LED', 'Blinker', 'USB', 'to', 'UART', 'bridge', 'CP2102N', 'power', 'supply', '5V', '3V3', 'buck', 'converter', 'ESP32-S3', 'DevKit', 'sensor', 'hub', 'motor', 'driver', 'H-bridge', 'audio', 'amp', 'class-D', 'Rev', 'B', 'prototype', 'final', 'v2', '10kΩ', 'µC', 'Ünïcödé', '测试板', '—', 'RP2040', 'LoRa', 'SX1262', 'breakout', 'thermocouple', 'MAX31856'];
  const mkName = (len) => {
    let s = '';
    while (s.length < len) s += (s ? ' ' : '') + pick(WORDS);
    return s.slice(0, len).trim() || 'x'.repeat(len);
  };
  const lenFor = (i) => [5, 12, 24, 40, 64, 90, 120, 150][i % 8];
  const uid = (p, i) => `${p}-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const NOW = Date.now();
  const iso = (msAgo) => new Date(NOW - msAgo).toISOString();
  const AGES = [5e3, 5 * 60e3, 3 * 3600e3, 2 * 86400e3, 40 * 86400e3, 800 * 86400e3];
  const json = (obj, status = 200, ct = 'application/json') => new Response(JSON.stringify(obj), { status, headers: { 'content-type': ct } });

  // ---------- Home: 300 designs ----------
  S.buildDesigns = (real) => {
    seed = 42;
    const previews = real.map((d) => d.schematicPreview).filter(Boolean);
    const DRC = [
      null,
      { ranAtRevision: 1, ranAt: iso(1e5), errors: 0, warnings: 0, infos: 0, stale: false },
      { ranAtRevision: 1, ranAt: iso(1e5), errors: 1, warnings: 0, infos: 0, stale: false },
      { ranAtRevision: 1, ranAt: iso(1e5), errors: 1234, warnings: 56789, infos: 0, stale: false },
      { ranAtRevision: 1, ranAt: iso(1e5), errors: 0, warnings: 3, infos: 0, stale: false },
      { ranAtRevision: 1, ranAt: iso(1e5), errors: 6, warnings: 11, infos: 0, stale: true },
      { ranAtRevision: 1, ranAt: iso(1e5), errors: 0, warnings: 0, infos: 5, stale: false },
    ];
    const out = [];
    for (let i = 0; i < 300; i++) {
      let name;
      if (i % 50 === 7) name = 'USB_to_UART_bridge_CP2102N_revC_final_final_v2_' + 'X'.repeat(100);
      else if (i % 50 === 13) name = 'QA-F1D-' + String(i).padStart(3, '0');
      else name = `${String(i).padStart(3, '0')} ${mkName(lenFor(i) - 4)}`.slice(0, lenFor(i));
      const age = AGES[i % AGES.length] + i * 1000;
      out.push({
        id: uid('f1d0d000', i),
        name,
        revision: [0, 1, 17, 540, 9999, 123456][i % 6],
        createdAt: iso(age + 30 * 86400e3),
        updatedAt: iso(age),
        drcStatus: DRC[i % DRC.length],
        schematicPreview: i % 5 === 4 || previews.length === 0 ? null : previews[i % previews.length],
      });
    }
    return out;
  };

  // ---------- Assistant: 200 chats, 120 messages ----------
  S.buildChats = () => {
    seed = 77;
    const out = [];
    for (let i = 0; i < 200; i++) {
      const linked = i % 3 !== 2;
      const title = i === 0
        ? 'F1D long thread — 120 messages with a very long title that should truncate cleanly in the header and in the sidebar row'
        : i % 10 === 5 ? 'Supercalifragilisticexpialidocious_unbroken_chat_title_' + 'Z'.repeat(80)
        : `${String(i).padStart(3, '0')} ${mkName(lenFor(i + 3))}`;
      out.push({
        id: uid('f1dc4a70', i),
        title,
        providerConfigId: 'openrouter',
        model: 'nvidia/nemotron-3.5-lightning:free',
        promptPresetId: 'strict-grounded',
        metadata: linked ? { scope: 'designer', designId: uid('f1d0d000', i), designName: i % 4 === 0 ? 'Very long linked design name ' + mkName(110) : mkName(20) } : null,
        createdAt: iso(AGES[i % AGES.length] + i * 60e3 + 3600e3),
        updatedAt: iso(i * 60e3 + (i ? AGES[i % AGES.length] : 0)),
        lastMessageAt: iso(i * 60e3 + (i ? AGES[i % AGES.length] : 0)),
      });
    }
    out.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
    return out;
  };
  const bigMessage = () => {
    const cols = 30;
    const head = '| ' + Array.from({ length: cols }, (_, c) => `Col${c + 1}_Header`).join(' | ') + ' |';
    const sep = '| ' + Array.from({ length: cols }, () => '---').join(' | ') + ' |';
    const rows = Array.from({ length: 12 }, (_, r) => '| ' + Array.from({ length: cols }, (_, c) => `R${r}C${c}=${(r * c * 0.137).toFixed(3)}`).join(' | ') + ' |');
    const code = '```ts\n' + Array.from({ length: 40 }, (_, k) => `const line${k} = computeTraceImpedance({ widthNm: ${100000 + k}, heightNm: 35000, dielectric: 4.5, spacingNm: 127000, layer: "F.Cu", net: "USB_D${k % 2 ? 'P' : 'N'}", comment: "${'wide '.repeat(30)}" }); // ${'x'.repeat(120)}`).join('\n') + '\n```';
    let body = '## Very long answer (10k chars)\n\n' + 'Lorem ipsum dolor sit amet, consectetur adipiscing elit. '.repeat(20) + '\n\n' + head + '\n' + sep + '\n' + rows.join('\n') + '\n\n' + code + '\n\nAn unbroken URL: https://example.com/' + 'a'.repeat(300) + '\n\n';
    while (body.length < 10000) body += 'More filler text to reach ten thousand characters in a single assistant message. ';
    return body;
  };
  S.buildMessages = (chatId) => {
    const msgs = [];
    for (let i = 1; i <= 120; i++) {
      const role = i % 2 ? 'user' : 'assistant';
      let content = role === 'user' ? `Q${i}: how do I route the ${pick(WORDS)} net on layer ${i % 4}?` : `A${i}: Use a **${pick(WORDS)}** approach. Step ${i}.\n\n- item one\n- item two`;
      if (i === 118) content = bigMessage();
      const dayOffset = Math.floor((120 - i) / 30);
      msgs.push({ id: `f1dm-${String(i).padStart(4, '0')}`, chatId, role, content, toolCallId: null, toolCallsJson: null, toolName: null, taskId: null, metadata: null, createdAt: iso(dayOffset * 86400e3 + (120 - i) * 60e3), updatedAt: iso(dayOffset * 86400e3 + (120 - i) * 60e3) });
    }
    return msgs;
  };

  // ---------- Docs: 300 pages nested 8 deep ----------
  S.buildTree = () => {
    seed = 99;
    const nodes = [];
    const depth = {};
    const orderKey = (i) => 'a' + String(i).padStart(4, '0');
    const title = (i) => i % 25 === 3 ? 'Unbroken_page_title_' + 'W'.repeat(120) : `${String(i).padStart(3, '0')} ${mkName(lenFor(i + 5))}`;
    for (let i = 0; i < 300; i++) {
      let parent = null;
      if (i >= 20 && i < 28) parent = i === 20 ? 0 : i - 1; // chain 0 → 20 → … → 27 (depth 8)
      else if (i >= 28) {
        let p; do { p = Math.floor(rnd() * i); } while (depth[p] >= 7);
        parent = p;
      }
      depth[i] = parent === null ? 0 : depth[parent] + 1;
      nodes.push({ id: uid('f1dd0c00', i), title: title(i), icon: i % 9 === 0 ? '🔧' : null, parent_id: parent === null ? null : uid('f1dd0c00', parent), project_id: null, is_project_root: false, order_key: orderKey(i), _p: parent });
    }
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const roots = [];
    for (const n of nodes) {
      if (n._p === null) roots.push(n);
      else { const p = nodes[n._p]; (p.children = p.children || []).push(n); }
    }
    for (const n of nodes) delete n._p;
    S.treeNodes = nodes;
    S.treeById = byId;
    S.treeDepth = depth;
    return roots;
  };
  const crumbs = (id) => {
    const out = [];
    let n = S.treeById.get(id);
    while (n) { out.unshift(n.title); n = n.parent_id ? S.treeById.get(n.parent_id) : null; }
    return out;
  };

  S.route = async (method, u) => {
    const p = u.pathname;
    if (method === 'GET' && S.mock.home && /\/api\/modules\/designer\/designs$/.test(p)) {
      const r = await W.__qaOrigFetch(u.href);
      const body = await r.json();
      S.marks.homeServed = performance.now();
      return json({ ok: true, data: { designs: S.buildDesigns(body.data?.designs ?? []) } });
    }
    if (S.mock.chats) {
      if (method === 'GET' && /\/api\/modules\/assistant\/chats$/.test(p)) return json(S.chats || (S.chats = S.buildChats()));
      const m = p.match(/\/api\/modules\/assistant\/chats\/(f1dc4a70-[^/]+)\/(messages|write-proposals|tool-events)$/);
      if (method === 'GET' && m) {
        if (m[2] !== 'messages') return json([]);
        if (m[1] !== uid('f1dc4a70', 0)) return json({ items: S.buildMessages(m[1]).slice(-2), hasMore: false, nextCursor: null });
        const all = S.msgs || (S.msgs = S.buildMessages(m[1]));
        const before = u.searchParams.get('before');
        const limit = Number(u.searchParams.get('limit') || 50);
        const end = before ? all.findIndex((x) => x.id === before) : all.length;
        const start = Math.max(0, end - limit);
        S.marks.msgPages = (S.marks.msgPages || 0) + 1;
        return json({ items: all.slice(start, end), hasMore: start > 0, nextCursor: start > 0 ? all[start].id : null });
      }
    }
    if (S.mock.docs) {
      if (method === 'GET' && /\/api\/modules\/knowledge\/workspaces\/default\/tree$/.test(p)) return json({ pages: S.buildTree() });
      if (method === 'GET' && /\/api\/modules\/knowledge\/search$/.test(p)) {
        if (!S.treeNodes) S.buildTree();
        const q = (u.searchParams.get('q') || '').toLowerCase();
        const hits = S.treeNodes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 60);
        return json({ results: hits.map((n) => ({ id: n.id, title: n.title, icon: n.icon, project_id: null, parent_id: n.parent_id, updated_at: iso(3600e3), breadcrumb: crumbs(n.id) })) });
      }
      const pm = p.match(/\/api\/modules\/knowledge\/pages\/(f1dd0c00-[^/]+)$/);
      if (method === 'GET' && pm) {
        const n = S.treeById && S.treeById.get(pm[1]);
        return json({ page: { id: pm[1], workspace_id: 'default', project_id: null, parent_id: n?.parent_id ?? null, is_project_root: false, order_key: n?.order_key ?? 'a', title: n?.title ?? 'x', icon: null, properties_json: {}, content_engine: 'tiptap', content_version: 1, content_json: { engine: 'tiptap', version: 1, data: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Synthetic page body.' }] }] } }, created_at: iso(86400e3), updated_at: iso(3600e3), deleted_at: null, revision: 1 } });
      }
    }
    return null;
  };

  W.fetch = async function qaFetch(input, init) {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const method = ((init && init.method) || (typeof input === 'object' && input && input.method) || 'GET').toUpperCase();
    const u = new URL(url, location.href);
    const isApi = u.pathname.startsWith('/api/');
    S.log.push({ t: Math.round(performance.now()), method, path: (u.pathname + u.search).slice(0, 140) });
    if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
    if (isApi && method !== 'GET') {
      S.blocked.push({ t: Math.round(performance.now()), method, path: u.pathname.slice(0, 140), body: init && typeof init.body === 'string' ? init.body.slice(0, 200) : null });
      return json({ error: 'QA_BLOCKED_WRITE' }, 503);
    }
    if (isApi && S.delay) await new Promise((r) => setTimeout(r, S.delay));
    if (isApi) {
      for (const f of S.fail) {
        if (new RegExp(f).test(u.pathname)) return json({ type: 'about:blank', title: 'Internal error', status: 500 }, 500, 'application/problem+json');
      }
      const m = await S.route(method, u);
      if (m) return m;
    }
    return W.__qaOrigFetch(input, init);
  };

  // rAF scroll-FPS probe: scroll `el` by `px` per frame for `frames` frames.
  S.scrollTest = (el, px, frames) => {
    const res = (S.fps = { done: false, deltas: [], start: performance.now(), scrollHeight: el.scrollHeight, clientHeight: el.clientHeight });
    el.scrollTop = 0;
    let last = performance.now();
    let n = 0;
    const step = () => {
      const now = performance.now();
      res.deltas.push(Math.round((now - last) * 10) / 10);
      last = now;
      el.scrollTop += px;
      if (++n < frames && el.scrollTop + el.clientHeight < el.scrollHeight - 1) requestAnimationFrame(step);
      else {
        const d = res.deltas.slice(1);
        const sorted = [...d].sort((a, b) => a - b);
        res.done = true;
        res.frames = d.length;
        res.avgMs = Math.round((d.reduce((a, b) => a + b, 0) / Math.max(1, d.length)) * 10) / 10;
        res.p95Ms = sorted[Math.floor(sorted.length * 0.95)] ?? null;
        res.maxMs = sorted[sorted.length - 1] ?? null;
        res.fps = Math.round(1000 / Math.max(1, res.avgMs));
        res.over50 = d.filter((x) => x > 50).length;
        delete res.deltas;
      }
    };
    requestAnimationFrame(step);
    return 'started';
  };
  S.findScroller = (minRows) => {
    const cands = [...document.querySelectorAll('div,aside,main,nav,section')].filter((e) => {
      const cs = getComputedStyle(e);
      return /(auto|scroll)/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 100 && e.clientHeight > 150;
    });
    return cands.sort((a, b) => b.scrollHeight - a.scrollHeight);
  };
  S.nav = (fn) => { import('/src/stores/navigation-store.ts').then((m) => { S.navStore = m.useNavigationStore; fn(m.useNavigationStore.getState()); }); return 'nav'; };
  return 'shim installed; delay=' + S.delay;
}
