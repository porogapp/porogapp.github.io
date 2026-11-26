/* Flight replay on a globe: the app's renderer (Porog/Shared/Globe) on a canvas. Orthographic projection, unit vectors, no libraries. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const source = document.currentScript.dataset.world, T = JSON.parse($('texts').textContent);
  const fill = (text, ...args) => text.replace(/\{(\d)\}/g, (_, i) => args[i]);
  const RAD = Math.PI / 180, EARTH = 6371, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const vector = (lon, lat) => [Math.cos(lat * RAD) * Math.cos(lon * RAD), Math.cos(lat * RAD) * Math.sin(lon * RAD), Math.sin(lat * RAD)];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const angle = (a, b) => Math.acos(clamp(dot(a, b), -1, 1));

  /* Geometry */
  function shape(coords) {
    const points = coords.map(([lon, lat]) => vector(lon, lat)), sum = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]);
    const length = Math.hypot(...sum);
    if (length < 1e-9) return { coords, points, axis: [0, 0, 1], hiddenBelow: -Infinity };
    /* A cap round the shape: it is skipped when the cap lies wholly behind the globe */
    const axis = sum.map(v => v / length), reach = Math.min(...points.map(p => dot(axis, p)));
    return { coords, points, axis, hiddenBelow: reach > 0 ? -Math.sqrt(Math.max(0, 1 - reach * reach)) - 1e-9 : -Infinity };
  }
  function decode(world) {
    const { scale, translate } = world;
    const arcs = world.arcs.map(arc => { let x = 0, y = 0; return arc.map(([dx, dy]) => [(x += dx) * scale[0] + translate[0], (y += dy) * scale[1] + translate[1]]); });
    const line = i => i >= 0 ? arcs[i] : [...arcs[~i]].reverse();
    const usage = new Map();
    const countries = world.countries.map(([code, rings]) => {
      new Set(rings.flat().map(i => i >= 0 ? i : ~i)).forEach(i => usage.set(i, (usage.get(i) || 0) + 1));
      return { code, rings: rings.map(ring => shape(ring.flatMap((i, n) => n ? line(i).slice(1) : line(i)))) };
    });
    const steps = (from, to, by) => Array.from({ length: Math.round((to - from) / by) + 1 }, (_, i) => from + i * by);
    return {
      countries,
      borders: [...usage].filter(([, n]) => n > 1).map(([i]) => shape(arcs[i])),
      graticule: [...steps(-180, 170, 10).map(lon => shape(steps(-80, 80, 2.5).map(lat => [lon, lat]))), ...steps(-80, 80, 10).map(lat => shape(steps(-180, 180, 2.5).map(lon => [lon, lat])))],
    };
  }
  /* The Schengen area is in Europe: France's and Norway's far shapes are left out */
  const inEurope = ({ coords: [[lon, lat]] }) => lon > -26 && lon < 33 && lat > 34 && lat < 72;
  const contains = (rings, lon, lat) => rings.reduce((inside, { coords }) => {
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
      const [x1, y1] = coords[i], [x2, y2] = coords[j];
      if (y1 > lat !== y2 > lat && lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) inside = !inside;
    }
    return inside;
  }, false);
  function projection(cam, view) {
    const sl = Math.sin(cam.lon * RAD), cl = Math.cos(cam.lon * RAD), sp = Math.sin(cam.lat * RAD), cp = Math.cos(cam.lat * RAD), r = view.radius * cam.zoom;
    return {
      r, axis: vector(cam.lon, cam.lat),
      raw(p) { const toward = p[0] * cl + p[1] * sl; return [p[1] * cl - p[0] * sl, cp * p[2] - sp * toward, sp * p[2] + cp * toward]; },
      screen: (x, y) => [view.cx + r * x, view.cy - r * y],
      invert(sx, sy) {
        const x = (sx - view.cx) / r, y = (view.cy - sy) / r, h = x * x + y * y;
        if (h > 1) return null;
        const c = Math.sqrt(1 - h), toward = cp * c - sp * y;
        return [Math.atan2(sl * toward + cl * x, cl * toward - sl * x) / RAD, Math.asin(clamp(sp * c + cp * y, -1, 1)) / RAD];
      },
    };
  }

  /* Timeline: the app's timings, in seconds */
  const INTRO = 1.2, FLY = 1.8, LEG = 2.7, CLOSE = 1.3;
  const ease = t => t < .5 ? 4 * t ** 3 : 1 - (2 - 2 * t) ** 3 / 2;
  function position(t, legs) {
    if (t < INTRO) return { leg: -1, progress: 0 };
    const leg = Math.min(legs - 1, Math.floor((t - INTRO) / LEG));
    return { leg, progress: t - INTRO >= legs * LEG ? 1 : Math.min(1, (t - INTRO - leg * LEG) / FLY) };
  }
  const arrivalTime = stop => stop ? INTRO + (stop - 1) * LEG + FLY : 0;
  const looking = (stop, zoom) => ({ lon: stop.lon, lat: stop.lat - (stop.lat * .2 + 8) / zoom, zoom });
  const blend = (a, b, k) => ({ lon: a.lon + (((b.lon - a.lon) % 360 + 540) % 360 - 180) * k, lat: a.lat + (b.lat - a.lat) * k, zoom: a.zoom + (b.zoom - a.zoom) * k });
  function director(route, pos) {
    if (pos.leg < 0) return looking(route.stops[0], CLOSE);
    const { from, to, angle: span } = route.legs[pos.leg], s = ease(pos.progress), fit = Math.max(1, Math.min(CLOSE, .8 / Math.sin(span / 2)));
    const zoom = fit + (CLOSE - fit) * (1 - Math.sin(Math.PI * s));
    return blend(looking(from, zoom), looking(to, zoom), s);
  }

  function makeRoute(places) {
    const stops = T.stops.map(([code, name, start, days]) => { const [lon, lat, colour] = places[code]; return { code, name, start, days, lon, lat, colour, point: vector(lon, lat) }; });
    const legs = stops.slice(1).map((to, i) => ({ from: stops[i], to, angle: angle(stops[i].point, to.point) }));
    return { stops, legs, total: INTRO + legs.length * LEG + .6 };
  }
  const kilometres = radians => (Math.round(radians * EARTH / 10) * 10).toLocaleString(document.documentElement.lang);

  function start(world) {
    const map = decode(world), route = makeRoute(world.places), schengen = new Set(world.schengen);
    const byCode = new Map(map.countries.map(c => [c.code, c])), names = new Intl.DisplayNames([document.documentElement.lang], { type: 'region' });
    const zone = map.countries.filter(c => schengen.has(c.code)).flatMap(c => c.rings.filter(inEurope));
    const yearDays = code => route.stops.filter(s => s.code === code).reduce((n, s) => n + s.days, 0);
    const canvas = $('globe-canvas'), ctx = canvas.getContext('2d'), now = $('globe-now'), play = $('globe-play'), chips = [...$('globe-stops').querySelectorAll('button')];
    const calm = matchMedia('(prefers-reduced-motion: reduce)'), narrow = matchMedia('(max-width: 900px)');
    /* mode: replay follows the flights, aim goes to a point, free is in the visitor's hands, spin turns by itself after the last flight */
    const state = { mode: 'replay', t: calm.matches ? route.total : 0, playing: false, begun: false, cam: looking(route.stops[0], 1), aim: null, speed: [0, 0], selected: '', hover: '', seen: false };
    let view = { w: 0, h: 0, cx: 0, cy: 0, radius: 1 }, frameId = 0, last = 0, shown = '';

    /* Drawing */
    const trace = (rings, proj) => {
      ctx.beginPath();
      for (const ring of rings) {
        if (dot(ring.axis, proj.axis) < ring.hiddenBelow) continue;
        const flat = ring.points.map(proj.raw);
        if (!flat.some(p => p[2] >= 0)) continue;
        flat.forEach(([x, y, c], i) => {
          const h = c < 0 ? Math.hypot(x, y) || 1 : 1, [sx, sy] = proj.screen(x / h, y / h);
          if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
        });
        ctx.closePath();
      }
    };
    const strokeLines = (lines, proj) => {
      ctx.beginPath();
      for (const { points, axis, hiddenBelow } of lines) {
        if (dot(axis, proj.axis) < hiddenBelow) continue;
        let pen = false;
        for (const p of points) {
          const [x, y, c] = proj.raw(p);
          if (c < 0) { pen = false; continue; }
          const [sx, sy] = proj.screen(x, y);
          if (pen) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy);
          pen = true;
        }
      }
      ctx.stroke();
    };
    /* A point of the leg lifted above the surface, higher for longer flights; null behind the globe */
    const lifted = ({ from, to, angle: span }, s, proj) => {
      const a = Math.sin((1 - s) * span) / Math.sin(span), b = Math.sin(s * span) / Math.sin(span);
      const [x, y, c] = proj.raw([0, 1, 2].map(i => a * from.point[i] + b * to.point[i])), h = 1 + Math.sin(Math.PI * s) * Math.min(.22, .05 + span * .14);
      return c > 0 || Math.sqrt(1 - c * c) * h > 1 ? proj.screen(x * h, y * h) : null;
    };
    const drawLeg = (leg, end, proj) => {
      ctx.beginPath();
      let pen = false;
      for (let i = 0; i <= 64; i++) {
        const p = lifted(leg, i / 64 * end, proj);
        if (p && pen) ctx.lineTo(...p); else if (p) ctx.moveTo(...p);
        pen = !!p;
      }
      ctx.stroke();
    };
    const disc = (x, y, r) => { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); };
    const glow = (x, y, from, to, alpha) => {
      const g = ctx.createRadialGradient(x, y, from, x, y, to);
      g.addColorStop(0, `rgb(242 238 230 / ${alpha})`); g.addColorStop(1, 'rgb(242 238 230 / 0)');
      ctx.fillStyle = g; disc(x, y, to); ctx.fill();
    };
    function draw(time) {
      const pos = position(state.t, route.legs.length), proj = projection(state.cam, view), { cx, cy } = view, r = proj.r;
      const visible = pos.leg < 0 ? 1 : pos.leg + 1 + (pos.progress >= 1 ? 1 : 0), current = pos.leg < 0 ? 0 : pos.progress >= 1 ? pos.leg + 1 : -1;
      ctx.clearRect(0, 0, view.w, view.h);
      glow(cx, cy, r * .94, r * 1.28, .16);
      ctx.save();
      disc(cx, cy, r);
      const sea = ctx.createRadialGradient(cx - r * .35, cy - r * .45, r * .1, cx, cy, r);
      sea.addColorStop(0, '#39406b'); sea.addColorStop(.6, '#2a2e4c'); sea.addColorStop(1, '#1d1f31');
      ctx.fillStyle = sea; ctx.fill(); ctx.clip();
      ctx.lineWidth = .6; ctx.strokeStyle = 'rgb(242 238 230 / .07)'; strokeLines(map.graticule, proj);
      trace(map.countries.flatMap(c => c.rings), proj); ctx.fillStyle = '#6a6355'; ctx.fill('evenodd');
      if (schengen.has(state.selected)) { trace(zone, proj); ctx.fillStyle = 'rgb(154 165 230 / .55)'; ctx.fill('evenodd'); }
      new Map(route.stops.slice(0, visible).map(s => [s.code, s.colour])).forEach((colour, code) => {
        trace(byCode.get(code).rings, proj); ctx.globalAlpha = current >= 0 && route.stops[current].code === code ? 1 : .8; ctx.fillStyle = colour; ctx.fill('evenodd'); ctx.globalAlpha = 1;
      });
      ctx.lineWidth = .7; ctx.strokeStyle = 'rgb(27 26 23 / .75)'; strokeLines(map.borders, proj);
      for (const [code, style, width] of [[state.hover, 'rgb(242 238 230 / .6)', 1.2], [state.selected, '#e3a452', 2]]) {
        if (!code) continue;
        trace(byCode.get(code).rings, proj); ctx.fillStyle = 'rgb(242 238 230 / .14)'; ctx.fill('evenodd'); ctx.strokeStyle = style; ctx.lineWidth = width; ctx.lineJoin = 'round'; ctx.stroke();
      }
      /* Shade towards the rim: the ball reads as round */
      const shade = ctx.createRadialGradient(cx - r * .3, cy - r * .35, r * .3, cx, cy, r);
      shade.addColorStop(0, 'rgb(20 19 24 / 0)'); shade.addColorStop(.7, 'rgb(20 19 24 / .12)'); shade.addColorStop(1, 'rgb(20 19 24 / .55)');
      disc(cx, cy, r); ctx.fillStyle = shade; ctx.fill();
      ctx.restore();
      disc(cx, cy, r); ctx.strokeStyle = 'rgb(242 238 230 / .16)'; ctx.lineWidth = 1; ctx.stroke();

      ctx.lineCap = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgb(242 238 230 / .42)';
      route.legs.slice(0, Math.max(0, pos.leg)).forEach(leg => drawLeg(leg, 1, proj));
      const leg = route.legs[pos.leg], s = ease(pos.progress);
      if (leg) {
        ctx.lineWidth = 2.2; ctx.strokeStyle = 'rgb(242 238 230 / .95)'; drawLeg(leg, s, proj);
        const plane = s < 1 && lifted(leg, s, proj);
        if (plane) { glow(...plane, 3, 14, .7); disc(...plane, 5); ctx.fillStyle = '#fffdf8'; ctx.fill(); }
      }
      new Set(route.stops.slice(0, visible)).forEach(stop => {
        const [x, y, c] = proj.raw(stop.point);
        if (c < 0) return;
        const [sx, sy] = proj.screen(x, y);
        disc(sx, sy, 3.5); ctx.fillStyle = '#fffdf8'; ctx.fill();
        if (state.mode === 'replay' && stop === route.stops[current] && state.playing) {
          const phase = time / 900 % 1;
          disc(sx, sy, 6 + phase * 14); ctx.strokeStyle = `rgb(255 253 248 / ${1 - phase})`; ctx.lineWidth = 1.5; ctx.stroke();
        }
      });
      caption(pos, current);
    }

    /* Words beside the globe */
    function about(code) {
      const days = yearDays(code), rule = T.countries.find(row => row[0] === code);
      return [names.of(code), [days ? fill(T.yearDays, days) : T.noDays, schengen.has(code) && fill(T.zoneLine, schengen.size), rule && fill(T.ruleLine, rule[2], rule[3])].filter(Boolean)];
    }
    function caption(pos, current) {
      const ended = state.t >= route.total, leg = route.legs[pos.leg], stop = route.stops[current];
      const [title, lines] = state.selected ? about(state.selected)
        : ended ? [T.sumTitle, [fill(T.sumLine, kilometres(route.legs.reduce((n, l) => n + l.angle, 0)))]]
        : stop ? [stop.name, [fill(T.stayLine, stop.start, stop.days)]]
        : [`${leg.from.name} → ${leg.to.name}`, [fill(T.kmLine, kilometres(leg.angle))]];
      const key = [title, ...lines, current, state.playing, state.selected].join('|');
      if (key === shown) return;
      shown = key;
      /* Read out only what the visitor asked for, not every step of the replay */
      now.setAttribute('aria-live', state.playing ? 'off' : 'polite');
      now.firstElementChild.textContent = title;
      now.lastElementChild.replaceChildren(...lines.map(text => Object.assign(document.createElement('li'), { textContent: text })));
      play.textContent = state.playing ? T.globePause : T.globePlay;
      chips.forEach((chip, i) => chip.setAttribute('aria-current', !ended && i === current && !state.selected));
    }

    /* Motion */
    function tick(time) {
      frameId = 0;
      const dt = Math.min(.05, (time - last) / 1000 || 0), k = calm.matches ? 1 : 1 - Math.exp(-dt * 6);
      last = time;
      let moving = false;
      if (state.playing) {
        state.t = Math.min(route.total, state.t + dt); moving = true;
        if (state.t >= route.total) { state.playing = false; state.mode = calm.matches ? 'free' : 'spin'; }
      }
      if (state.mode === 'replay') state.cam = blend(state.cam, director(route, position(state.t, route.legs.length)), state.playing ? Math.max(k, dt * 8) : k);
      if (state.mode === 'aim') {
        state.cam = blend(state.cam, state.aim, k);
        const left = Math.abs(((state.aim.lon - state.cam.lon) % 360 + 540) % 360 - 180) + Math.abs(state.aim.lat - state.cam.lat) + Math.abs(state.aim.zoom - state.cam.zoom);
        moving = left > .05; if (!moving) state.mode = 'free';
      }
      if (state.mode === 'spin') { state.cam = { ...blend(state.cam, { ...state.cam, lat: 22, zoom: 1 }, k * .4), lon: state.cam.lon + dt * 5 }; moving = true; }
      if (state.mode === 'free' && !held.size && Math.hypot(...state.speed) > 1 && !calm.matches) {
        turn(state.speed[0] * dt, state.speed[1] * dt); state.speed = state.speed.map(v => v * Math.exp(-dt * 3.2)); moving = true;
      }
      draw(time);
      if (moving) wake();
    }
    const wake = () => { if (!frameId && state.seen && !document.hidden) frameId = requestAnimationFrame(tick); };
    const redraw = () => { if (!frameId) last = performance.now(); wake(); };
    const turn = (dLon, dLat) => { state.cam = { ...state.cam, lon: state.cam.lon + dLon, lat: clamp(state.cam.lat + dLat, -85, 85) }; };
    const grab = () => { state.playing = false; state.mode = 'free'; state.speed = [0, 0]; };
    const zoomBy = factor => { grab(); state.cam = { ...state.cam, zoom: clamp(state.cam.zoom * factor, 1, 5) }; redraw(); };
    const aimAt = target => { grab(); state.aim = { ...target, lat: clamp(target.lat, -85, 85) }; state.mode = 'aim'; redraw(); };
    function toggle() {
      state.selected = '';
      if (state.playing) state.playing = false;
      else { if (state.t >= route.total) state.t = 0; state.mode = 'replay'; state.playing = true; }
      state.begun = true; redraw();
    }
    function visit(stop) { state.selected = ''; state.begun = true; state.t = arrivalTime(stop); aimAt(looking(route.stops[stop], Math.max(CLOSE, state.cam.zoom))); }
    const countryAt = (x, y) => {
      const place = projection(state.cam, view).invert(x, y);
      return place ? map.countries.find(c => c.code && contains(c.rings, ...place))?.code || '' : '';
    };
    function select(code) {
      state.selected = code === state.selected ? '' : code; state.begun = true; grab(); redraw();
    }

    /* Hands: one finger or the mouse turns, two fingers zoom, a tap picks a country */
    const held = new Map();
    let moved = 0, stamp = 0;
    const local = e => { const box = canvas.getBoundingClientRect(); return [e.clientX - box.left, e.clientY - box.top]; };
    const spread = () => { const [a, b] = [...held.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
    canvas.addEventListener('pointerdown', e => {
      if (e.button) return;
      canvas.setPointerCapture(e.pointerId); held.set(e.pointerId, local(e));
      if (held.size === 1) { moved = 0; stamp = e.timeStamp; }
    });
    canvas.addEventListener('pointermove', e => {
      const at = local(e), was = held.get(e.pointerId);
      if (!was) {
        const code = e.pointerType === 'mouse' ? countryAt(...at) : '';
        if (code !== state.hover) { state.hover = code; canvas.style.cursor = code ? 'pointer' : ''; canvas.title = code ? names.of(code) : ''; redraw(); }
        return;
      }
      const before = held.size === 2 ? spread() : 0;
      held.set(e.pointerId, at);
      const dx = at[0] - was[0], dy = at[1] - was[1];
      moved += Math.hypot(dx, dy);
      if (moved < 6) return;
      state.begun = true;
      if (held.size === 2) { if (before) zoomBy(spread() / before); return; }
      grab();
      const perPixel = 1 / (RAD * view.radius * state.cam.zoom), dt = Math.max(.008, (e.timeStamp - stamp) / 1000);
      turn(-dx * perPixel, dy * perPixel);
      state.speed = [clamp(-dx * perPixel / dt, -110, 110), clamp(dy * perPixel / dt, -60, 60)]; stamp = e.timeStamp;
      redraw();
    });
    const release = e => {
      if (!held.delete(e.pointerId)) return;
      if (e.type === 'pointerup' && moved < 6) select(countryAt(...local(e)));
      if (e.type === 'pointerup' && e.timeStamp - stamp > 80 || held.size) state.speed = [0, 0];
      redraw();
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);
    canvas.addEventListener('pointerleave', () => { if (state.hover) { state.hover = ''; canvas.title = ''; redraw(); } });
    /* A plain wheel scrolls the page; a pinch on the trackpad arrives as a wheel with Ctrl */
    canvas.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); state.begun = true; zoomBy(Math.exp(-e.deltaY * .01)); } }, { passive: false });
    const KEYS = { ArrowLeft: () => turn(-8 / state.cam.zoom, 0), ArrowRight: () => turn(8 / state.cam.zoom, 0), ArrowUp: () => turn(0, 8 / state.cam.zoom), ArrowDown: () => turn(0, -8 / state.cam.zoom) };
    canvas.addEventListener('keydown', e => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (KEYS[e.key]) { grab(); KEYS[e.key](); state.begun = true; redraw(); }
      else if (e.key === '+' || e.key === '=') zoomBy(1.25);
      else if (e.key === '-') zoomBy(.8);
      else if (e.key === ' ') toggle();
      else if (e.key === 'Escape' && state.selected) select('');
      else return;
      e.preventDefault();
    });
    play.addEventListener('click', toggle);
    $('globe-in').addEventListener('click', () => aimAt({ ...state.cam, zoom: clamp(state.cam.zoom * 1.5, 1, 5) }));
    $('globe-out').addEventListener('click', () => aimAt({ ...state.cam, zoom: clamp(state.cam.zoom / 1.5, 1, 5) }));
    chips.forEach((chip, i) => { chip.style.setProperty('--c', route.stops[i].colour); chip.addEventListener('click', () => visit(i)); });

    /* Size and visibility */
    function resize() {
      const w = canvas.clientWidth, h = canvas.clientHeight, scale = Math.min(2, devicePixelRatio || 1);
      if (!w || !h) return;
      canvas.width = Math.round(w * scale); canvas.height = Math.round(h * scale); ctx.setTransform(scale, 0, 0, scale, 0, 0);
      view = narrow.matches ? { w, h, cx: w / 2, cy: h * .52, radius: Math.min(w, h) * .38 } : { w, h, cx: w * .33, cy: h / 2, radius: Math.min(w * .25, h * .36) };
      state.seen ? tickNow() : draw(0);
    }
    const tickNow = () => { last = performance.now(); draw(last); wake(); };
    new ResizeObserver(resize).observe(canvas);
    $('globe-keys').hidden = false;
    new IntersectionObserver(([entry]) => {
      state.seen = entry.isIntersecting;
      if (!state.begun && entry.intersectionRatio > .45) { state.begun = true; if (!calm.matches) state.playing = true; }
      redraw();
    }, { threshold: [0, .5] }).observe(canvas);
    document.addEventListener('visibilitychange', redraw);
  }

  /* The map loads when the globe comes near; a failed load is tried again the next time it does */
  let loading = false;
  const near = new IntersectionObserver(async ([entry]) => {
    if (!entry.isIntersecting || loading) return;
    loading = true;
    try {
      const answer = await fetch(source, { signal: AbortSignal.timeout(20000) });
      if (!answer.ok) throw new Error(`${answer.status} ${source}`);
      const world = await answer.json();
      near.disconnect(); $('globe').classList.remove('off'); start(world);
    } catch (error) { loading = false; $('globe').classList.add('off'); console.error('Globe:', error); }
  }, { rootMargin: '600px' });
  near.observe($('globe'));
})();
