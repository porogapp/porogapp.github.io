(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const fill = (text, ...args) => text.replace(/\{(\d)\}/g, (_, i) => args[i]);
  const store = (key, value) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage is blocked: the choice lasts until the page closes */ } };
  const page = document.documentElement, data = $('#texts'), T = data && JSON.parse(data.textContent);

  /* Language: remember the choice, close the list on an outside click */
  $$('.langs a').forEach(a => a.addEventListener('click', () => store('lang', a.hreflang)));
  const list = $('.lang');
  document.addEventListener('click', e => { if (!list.contains(e.target)) list.open = false; });

  /* Theme: the <head> script has set the starting one. Back to the device's theme means following it again */
  $('#theme').addEventListener('click', () => {
    const next = page.dataset.theme === 'dark' ? 'light' : 'dark';
    page.dataset.theme = next;
    store('theme', next === (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') ? null : next);
  });

  /* Residency: the chosen country's stamp */
  const INKS = ['', 'blue', 'red'];
  $$('.code-of').forEach((button, i, all) => button.addEventListener('click', () => {
    all.forEach(o => o.setAttribute('aria-pressed', o === button));
    const [, country, threshold, period, note] = T.countries[i], old = $('#stamp'), stamp = old.cloneNode(true);
    stamp.className = `stamp ${INKS[i % INKS.length]}`;
    $('b', stamp).textContent = country; $('strong', stamp).textContent = threshold; $('i', stamp).textContent = period;
    old.replaceWith(stamp); $('#note').textContent = note;
  }));

  /* 90/180: days are indices on the board, a stay is [first, last] */
  const board = $('#board');
  if (board) {
    const WINDOW = 180, LIMIT = 90, TODAY = 179, DAYS = 240, LATER = 45, STAYS = [[20, 44], [90, 110], [150, 164]];
    const within = (day, [first, last]) => day >= first && day <= last;
    const stayed = day => STAYS.some(stay => within(day, stay));
    const planned = (day, trip) => within(day, [TODAY + 1, TODAY + trip]);
    const used = (day, trip) => Array.from({ length: WINDOW }, (_, i) => day - i).filter(d => stayed(d) || planned(d, trip)).length;
    const firstOver = trip => Array.from({ length: trip }, (_, i) => i + 1).find(n => used(TODAY + n, trip) > LIMIT);
    const days = Array.from({ length: DAYS }, (_, i) => i);
    const cells = days.map(i => { const cell = document.createElement('i'); cell.className = 'cell'; cell.style.setProperty('--i', i); board.append(cell); return cell; });
    const say = $('#say'), trip = $('#trip'), range = $('#length'), length = $('#length-text');
    const STEPS = [{ end: TODAY, stays: false }, { end: TODAY, stays: true }, { end: TODAY + LATER, stays: true }, { end: TODAY, stays: true, plan: true }];
    let step = 0;
    function verdict(n) {
      const over = firstOver(n);
      return over ? fill(T.tripOver, over, used(TODAY + over, n)) : fill(T.tripFits, used(TODAY + n, n));
    }
    function draw() {
      const { end, stays, plan } = STEPS[step], n = plan ? +range.value : 0, over = plan && firstOver(n) || Infinity, last = end + n;
      cells.forEach((cell, i) => {
        const inside = i <= last && i > last - WINDOW, trip = planned(i, n), late = trip && i - TODAY >= over;
        cell.className = ['cell', inside && 'in', stays && stayed(i) && 'stay', trip && !late && 'plan', late && 'over', i === end && 'today'].filter(Boolean).join(' ');
      });
      trip.hidden = !plan; length.textContent = fill(T.tripDays, range.value);
      const text = plan ? verdict(n) : [T.say0, T.say1, T.say2][step];
      if (say.textContent !== text) say.textContent = text;
    }
    range.addEventListener('input', draw);
    const steps = $$('.step'), margin = matchMedia('(max-width: 900px)').matches ? '-76% 0px -23% 0px' : '-55% 0px -44% 0px';
    const io = new IntersectionObserver(es => es.filter(e => e.isIntersecting).forEach(e => {
      step = +e.target.dataset.step; steps.forEach(s => s.classList.toggle('off', s !== e.target)); draw();
    }), { rootMargin: margin });
    steps.forEach(s => io.observe(s)); draw();
  }

  /* Parallax: an element is at its natural place when centred on screen (hero: when the page is at the top) */
  const dig = $('#dig'), depth = $('#depth'), hero = $('[data-scene="top"]');
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const docTop = el => { let y = 0; for (; el; el = el.offsetParent) y += el.offsetTop; return y; };
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const layers = $$('[data-y],[data-x],[data-m]').map(el => ({ el, y: +el.dataset.y || 0, x: +el.dataset.x || 0, m: +el.dataset.m || 0, hero: !!hero && hero.contains(el), c: 0, h: 0, near: false, was: '' }));
  const risers = $$('.riser').map(el => ({ el, c: 0, near: false, was: '' }));
  let vh = innerHeight, reach = 1, digTop = 0, digH = 1, pos = scrollY, aim = scrollY, px = 0, py = 0, tx = 0, ty = 0, busy = false, dayWas = -1;
  /* Only what moves on screen gets its own layer and a style write */
  function move(item, near, translate) {
    if (item.near !== near) { item.near = near; item.el.style.willChange = near ? 'translate' : ''; }
    if (near && item.was !== translate) { item.was = translate; item.el.style.translate = translate; }
  }
  function measure() {
    vh = innerHeight; reach = Math.min(1, innerWidth / 1300) ** 2;
    layers.forEach(l => { l.h = l.el.offsetHeight; l.c = docTop(l.el) + l.h / 2; });
    risers.forEach(r => { r.c = docTop(r.el.parentNode) + r.el.parentNode.offsetHeight / 2; });
    if (dig) { digTop = docTop(dig); digH = dig.offsetHeight; }
    paint();
  }
  function paint() {
    const mid = pos + vh / 2;
    if (dig) {
      const day = Math.round(clamp((mid - digTop) / (digH - vh / 2), 0, 1) * 90);
      if (day !== dayWas) { dayWas = day; depth.textContent = fill(T.day, day); }
    }
    if (still.matches) return;
    layers.forEach(l => {
      const d = l.hero ? pos : mid - l.c;
      const near = l.hero ? pos < vh * 1.4 : Math.abs(d) < vh * 1.1 + l.h / 2;
      move(l, near, near ? `${(d * l.x + px * l.m * reach).toFixed(1)}px ${(d * l.y + py * l.m * .5 * reach).toFixed(1)}px` : '');
    });
    risers.forEach(r => move(r, Math.abs(r.c - mid) < vh, `0 ${(clamp((r.c - mid) / vh - .08, 0, .5) * 90).toFixed(1)}%`));
    if (hero && pos < vh * 1.4) { hero.style.setProperty('--px', px.toFixed(3)); hero.style.setProperty('--py', py.toFixed(3)); }
  }
  function tick() {
    pos += (aim - pos) * .16; px += (tx - px) * .08; py += (ty - py) * .08;
    const done = Math.abs(aim - pos) < .3 && Math.abs(tx - px) + Math.abs(ty - py) < .002;
    if (done) pos = aim;
    paint(); busy = !done; if (busy) requestAnimationFrame(tick);
  }
  const wake = () => { if (!busy) { busy = true; requestAnimationFrame(tick); } };
  addEventListener('scroll', () => { aim = scrollY; wake(); }, { passive: true });
  addEventListener('pointermove', e => { if (e.pointerType === 'mouse' && scrollY < vh * 1.4) { tx = e.clientX / innerWidth * 2 - 1; ty = e.clientY / vh * 2 - 1; wake(); } }, { passive: true });
  /* The observer runs right after layout: reading positions there does not force another one */
  new ResizeObserver(measure).observe($('.frame'));
  addEventListener('resize', () => requestAnimationFrame(measure));
})();
