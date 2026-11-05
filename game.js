/* Integer Racer — canvas runner. Mobile-first, low-data. */
(function () {
  'use strict';

  const API_NS = 'bnhs-iracer-nov2026';
  const API = 'https://mantledb.sh/v2/' + API_NS;
  const API_EXPORT = 'https://mantledb.sh/v2/export/' + API_NS;
  // Same Apps Script endpoint as ADM Portal (read-only action=config → learners)
  const ADM_API =
    'https://script.google.com/macros/s/AKfycbwGMSP8NmPT4GYMJZTw4qruizfFd5wzORZHZRM-HOUJOSQyyg3Gx20L5MEWsqT5EFdl-w/exec';

  const LEVELS = 5;
  const ITEMS = 20;
  const LIVES = 3;
  const MAX_ATTEMPTS = 1;
  const BASE_PTS = [0, 10, 20, 30, 40, 50];
  // Exact-ish seconds from spawn until gate hit, per level
  const ITEM_SEC = [0, 8, 7, 6, 6, 7];
  const GATE_SPAWN = 1.4;
  const GATE_HIT_Z = 0.12;
  const GATE_DIST = GATE_SPAWN - GATE_HIT_Z;
  const MAX_PLAUSIBLE = 5000;
  const DEMO =
    /(?:\?|&)(?:demo|test)=1(?:&|$)/.test(location.search || '') ||
    location.hash === '#demo';


  // ---- Web Audio music + SFX (no files; unlock on first tap) ----
  const Sound = (function () {
    let ctx = null;
    let master = null;
    let musicGain = null;
    let sfxGain = null;
    let unlocked = false;
    let enabled = localStorage.getItem('ir-sound') !== '0';
    let musicNodes = [];
    let musicTimer = null;
    let humOsc = null;
    let humGain = null;
    let level = 1;

    function ensure() {
      if (ctx) return ctx;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = enabled ? 0.7 : 0;
      master.connect(ctx.destination);
      musicGain = ctx.createGain();
      musicGain.gain.value = 0.22;
      musicGain.connect(master);
      sfxGain = ctx.createGain();
      sfxGain.gain.value = 0.55;
      sfxGain.connect(master);
      return ctx;
    }

    function unlock() {
      const c = ensure();
      if (!c) return;
      if (c.state === 'suspended') c.resume().catch(() => {});
      if (!unlocked) {
        unlocked = true;
        // silent blip to satisfy mobile gesture unlock
        const o = c.createOscillator();
        const g = c.createGain();
        g.gain.value = 0.0001;
        o.connect(g);
        g.connect(master);
        o.start();
        o.stop(c.currentTime + 0.01);
        if (enabled) startMusic(level);
      }
    }

    function setEnabled(on) {
      enabled = !!on;
      localStorage.setItem('ir-sound', enabled ? '1' : '0');
      ensure();
      if (master) master.gain.setTargetAtTime(enabled ? 0.7 : 0, ctx.currentTime, 0.05);
      if (enabled && unlocked) startMusic(level);
      else stopMusic();
      paintBtn();
    }

    function paintBtn() {
      const b = document.getElementById('btn-sound');
      if (!b) return;
      b.textContent = enabled ? '🔊 On' : '🔇 Off';
      b.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    }

    function tone(freq, dur, type, gain, when) {
      const c = ensure();
      if (!c || !enabled || !unlocked) return;
      const t0 = when != null ? when : c.currentTime;
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.3, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g);
      g.connect(sfxGain);
      o.start(t0);
      o.stop(t0 + dur + 0.02);
    }

    function ding() {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      tone(880, 0.12, 'sine', 0.35, t);
      tone(1320, 0.18, 'sine', 0.25, t + 0.06);
    }

    function buzz() {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      tone(180, 0.22, 'sawtooth', 0.22, t);
      tone(120, 0.28, 'square', 0.15, t + 0.05);
    }

    function levelUp() {
      const c = ensure();
      if (!c) return;
      const t = c.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.18, 'triangle', 0.28, t + i * 0.1));
    }

    function stopMusic() {
      if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
      musicNodes.forEach((n) => {
        try {
          n.stop();
        } catch (e) {}
      });
      musicNodes = [];
      if (humOsc) {
        try {
          humOsc.stop();
        } catch (e) {}
        humOsc = null;
        humGain = null;
      }
    }

    function startMusic(lv) {
      level = lv || 1;
      const c = ensure();
      if (!c || !enabled || !unlocked) return;
      stopMusic();
      // Engine hum (optional low drone)
      humOsc = c.createOscillator();
      humGain = c.createGain();
      humOsc.type = 'sawtooth';
      humOsc.frequency.value = 55 + level * 4;
      humGain.gain.value = 0.04;
      humOsc.connect(humGain);
      humGain.connect(musicGain);
      humOsc.start();

      // Upbeat arpeggio loop; tempo rises with level
      const bpm = 96 + (level - 1) * 10; // 96 → 136
      const step = 60 / bpm / 2; // eighth notes
      const scale = [0, 3, 5, 7, 10, 12, 15, 17]; // minor pent-ish
      const root = 220;
      let i = 0;
      function beat() {
        if (!enabled || !unlocked || !ctx) return;
        const t = ctx.currentTime;
        const note = scale[i % scale.length];
        const freq = root * Math.pow(2, note / 12);
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = i % 4 === 0 ? 'square' : 'triangle';
        o.frequency.value = freq;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.18, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + step * 1.6);
        o.connect(g);
        g.connect(musicGain);
        o.start(t);
        o.stop(t + step * 2);
        musicNodes.push(o);
        // kick on downs
        if (i % 4 === 0) {
          const k = ctx.createOscillator();
          const kg = ctx.createGain();
          k.type = 'sine';
          k.frequency.setValueAtTime(140, t);
          k.frequency.exponentialRampToValueAtTime(50, t + 0.15);
          kg.gain.setValueAtTime(0.25, t);
          kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
          k.connect(kg);
          kg.connect(musicGain);
          k.start(t);
          k.stop(t + 0.2);
          musicNodes.push(k);
        }
        // prune stopped
        if (musicNodes.length > 40) musicNodes = musicNodes.slice(-20);
        i++;
      }
      beat();
      musicTimer = setInterval(beat, step * 1000);
    }

    function setLevel(lv) {
      if (level === lv) return;
      level = lv;
      if (enabled && unlocked) startMusic(level);
    }

    function toggle() {
      unlock();
      setEnabled(!enabled);
    }

    // Unlock on first user gesture anywhere
    ['pointerdown', 'touchstart', 'keydown'].forEach((ev) => {
      window.addEventListener(
        ev,
        () => {
          unlock();
        },
        { once: false, passive: true }
      );
    });

    return {
      unlock,
      toggle,
      setEnabled,
      ding,
      buzz,
      levelUp,
      setLevel,
      startMusic,
      stopMusic,
      paintBtn,
      isEnabled: () => enabled,
    };
  })();


  const $ = (id) => document.getElementById(id);
  const screens = {
    start: $('screen-start'),
    game: $('screen-game'),
    summary: $('screen-summary'),
    board: $('screen-board'),
  };

  function show(name) {
    Object.keys(screens).forEach((k) => {
      screens[k].classList.toggle('active', k === name);
    });
  }

  let learners = []; // {g,s,n,l,f} from ADM Portal
  let player = { name: '', grade: '11', section: '' };
  let progress = blankProgress();
  let run = null;
  let attempt = null;
  let raf = 0;
  let remoteRecord = null;
  let shakeT = 0;

  function blankProgress() {
    return { attemptsUsed: 0, bestTotal: 0, bestLevel: 0, attemptScores: [] };
  }

  function keyOf(p) {
    return norm(p.name) + '-g' + String(p.grade).replace(/\D/g, '');
  }
  function norm(s) {
    return (
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '')
        .slice(0, 48) || 'anon'
    );
  }
  function gradeNum(g) {
    const m = String(g || '').match(/(\d+)/);
    return m ? m[1] : String(g);
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem('ir-progress-' + keyOf(player));
      if (raw) {
        const p = JSON.parse(raw);
        progress.attemptsUsed = Math.max(0, Number(p.attemptsUsed) || 0);
        progress.bestTotal = Math.max(0, Number(p.bestTotal) || 0);
        progress.bestLevel = Math.max(0, Number(p.bestLevel) || 0);
        progress.attemptScores = Array.isArray(p.attemptScores) ? p.attemptScores : [];
      }
    } catch (e) {}
  }
  function saveLocal() {
    try {
      localStorage.setItem('ir-progress-' + keyOf(player), JSON.stringify(progress));
    } catch (e) {}
  }

  async function fetchRemoteRecord() {
    try {
      const path = API + '/scores/' + keyOf(player) + '?t=' + Date.now();
      const r = await fetch(path);
      if (!r.ok) return null;
      const j = await r.json();
      if (j && j.error) return null;
      if (j && j.name) return j;
      return null;
    } catch (e) {
      return null;
    }
  }

  function mergeRemote(rec) {
    remoteRecord = rec;
    if (!rec) return;
    progress.attemptsUsed = Math.max(progress.attemptsUsed, Math.max(0, Number(rec.attempts) || 0));
    progress.bestTotal = Math.max(progress.bestTotal, Math.max(0, Number(rec.total) || 0));
    progress.bestLevel = Math.max(progress.bestLevel, Math.max(0, Number(rec.bestLevel) || 0));
    if (Array.isArray(rec.attemptScores) && rec.attemptScores.length) {
      const set = new Set(progress.attemptScores.concat(rec.attemptScores.map(Number)));
      progress.attemptScores = [...set].filter((n) => Number.isFinite(n));
    }
    saveLocal();
  }

  async function fetchBoard() {
    try {
      const r = await fetch(API_EXPORT + '?t=' + Date.now());
      const j = await r.json();
      const entries = [];
      const bag = (j && j.entries) || {};
      Object.keys(bag).forEach((path) => {
        if (path.indexOf('scores/') === 0 && bag[path] && bag[path].name) entries.push(bag[path]);
      });
      return entries.filter((e) => Number(e.total) <= MAX_PLAUSIBLE);
    } catch (e) {
      try {
        return JSON.parse(localStorage.getItem('ir-local-board') || '[]');
      } catch (e2) {
        return [];
      }
    }
  }

  async function submitRecord(entry) {
    const local = JSON.parse(localStorage.getItem('ir-local-board') || '[]');
    const idx = local.findIndex((e) => norm(e.name) === norm(entry.name) && String(e.grade) === String(entry.grade));
    if (idx >= 0) local[idx] = entry;
    else local.push(entry);
    localStorage.setItem('ir-local-board', JSON.stringify(local));

    try {
      const path = API + '/scores/' + keyOf(entry);
      let best = Object.assign({}, entry);
      try {
        const prev = await (await fetch(path + '?t=' + Date.now())).json();
        if (prev && prev.name) {
          best.total = Math.max(Number(prev.total) || 0, Number(entry.total) || 0);
          best.bestLevel = Math.max(Number(prev.bestLevel) || 0, Number(entry.bestLevel) || 0);
          best.attempts = Math.min(
            MAX_ATTEMPTS,
            Math.max(Number(prev.attempts) || 0, Number(entry.attempts) || 0)
          );
          const scores = []
            .concat(Array.isArray(prev.attemptScores) ? prev.attemptScores : [])
            .concat(Array.isArray(entry.attemptScores) ? entry.attemptScores : [])
            .map(Number)
            .filter((n) => Number.isFinite(n));
          best.attemptScores = [...new Set(scores)].slice(-4);
          if ((Number(prev.attempts) || 0) >= MAX_ATTEMPTS) {
            best.attempts = MAX_ATTEMPTS;
            if (Array.isArray(prev.attemptScores) && prev.attemptScores.length >= MAX_ATTEMPTS) {
              best.attemptScores = prev.attemptScores.slice(0, MAX_ATTEMPTS);
            }
          }
          if ((Number(prev.total) || 0) > (Number(entry.total) || 0)) {
            best.name = prev.name;
            best.section = prev.section || entry.section;
          }
        }
      } catch (e) {}
      if (Number(best.total) > MAX_PLAUSIBLE) return false;
      best.attempts = Math.min(MAX_ATTEMPTS, Math.max(0, Number(best.attempts) || 0));
      await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(best),
      });
      remoteRecord = best;
      return true;
    } catch (e) {
      return false;
    }
  }

  const MEDALS = ['', '🥇', '🥈', '🥉'];

  function sortBoard(list) {
    // Points desc, then highest level desc, then earliest finish (ts asc)
    return list.slice().sort((a, b) => {
      const pt = Number(b.total) - Number(a.total);
      if (pt) return pt;
      const lv = Number(b.bestLevel || 0) - Number(a.bestLevel || 0);
      if (lv) return lv;
      const ta = Number(a.ts) || Number.MAX_SAFE_INTEGER;
      const tb = Number(b.ts) || Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  }

  function renderBoard(entries, filter) {
    const tb = $('board-body');
    tb.innerHTML = '';
    let list = entries.slice();
    if (filter === '11') list = list.filter((e) => String(e.grade) === '11');
    if (filter === '12') list = list.filter((e) => String(e.grade) === '12');
    list = sortBoard(list);
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="5" class="muted">No scores yet. Be the first!</td></tr>';
      return;
    }
    list.slice(0, 100).forEach((e, i) => {
      const rank = i + 1;
      const tr = document.createElement('tr');
      if (rank <= 3) tr.className = 'rank-' + rank;
      const gs =
        'G' +
        esc(e.grade) +
        (e.section ? ' · ' + esc(e.section) : '');
      const medal = MEDALS[rank] || '';
      tr.innerHTML =
        '<td class="rank-cell">' +
        (medal ? medal + ' ' : '') +
        rank +
        '</td><td>' +
        esc(e.name) +
        '</td><td class="gs">' +
        gs +
        '</td><td class="pts">' +
        Number(e.total) +
        '</td><td class="lvl">L' +
        Number(e.bestLevel || 0) +
        '</td>';
      tb.appendChild(tr);
    });
  }
  function esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ---- Master list (ADM Portal) ----
  async function loadLearners() {
    const status = $('load-status');
    try {
      const r = await fetch(ADM_API + '?action=config&t=' + Date.now());
      const j = await r.json();
      learners = Array.isArray(j.learners) ? j.learners.filter((x) => x && x.n && x.g && x.s) : [];
      if (!learners.length) {
        status.textContent = 'Class list empty — ask your teacher.';
        return;
      }
      const grades = [...new Set(learners.map((x) => gradeNum(x.g)))].sort();
      const gSel = $('inp-grade');
      gSel.innerHTML = '<option value="">Select grade</option>';
      grades.forEach((g) => {
        const o = document.createElement('option');
        o.value = g;
        o.textContent = 'Grade ' + g;
        gSel.appendChild(o);
      });
      const g11 = learners.filter((x) => gradeNum(x.g) === '11').length;
      const g12 = learners.filter((x) => gradeNum(x.g) === '12').length;
      status.textContent = 'Loaded ' + learners.length + ' learners (G11: ' + g11 + ', G12: ' + g12 + ').';
      $('btn-play').disabled = true;
    } catch (e) {
      status.textContent = 'Could not load class list. Check connection / try again.';
      $('inp-grade').innerHTML = '<option value="">Unavailable</option>';
    }
  }

  function fillSections() {
    const g = $('inp-grade').value;
    const sSel = $('inp-section');
    const nSel = $('inp-name');
    nSel.innerHTML = '<option value="">Select section first</option>';
    nSel.disabled = true;
    $('btn-play').disabled = true;
    if (!g) {
      sSel.innerHTML = '<option value="">Select grade first</option>';
      sSel.disabled = true;
      return;
    }
    const secs = [...new Set(learners.filter((x) => gradeNum(x.g) === g).map((x) => x.s))].sort();
    sSel.innerHTML = '<option value="">Select section</option>';
    secs.forEach((s) => {
      const o = document.createElement('option');
      o.value = s;
      o.textContent = s;
      sSel.appendChild(o);
    });
    sSel.disabled = false;
  }

  function fillNames() {
    const g = $('inp-grade').value;
    const s = $('inp-section').value;
    const nSel = $('inp-name');
    $('btn-play').disabled = true;
    if (!g || !s) {
      nSel.innerHTML = '<option value="">Select section first</option>';
      nSel.disabled = true;
      return;
    }
    const names = learners
      .filter((x) => gradeNum(x.g) === g && x.s === s)
      .map((x) => x.n)
      .sort((a, b) => a.localeCompare(b));
    nSel.innerHTML = '<option value="">Select your name</option>';
    names.forEach((n) => {
      const o = document.createElement('option');
      o.value = n;
      o.textContent = n;
      nSel.appendChild(o);
    });
    nSel.disabled = false;
  }

  $('inp-grade').onchange = fillSections;
  $('inp-section').onchange = fillNames;
  $('inp-name').onchange = () => {
    $('btn-play').disabled = !$('inp-name').value;
  };

  // ---- Canvas ----
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let W = 360,
    H = 640;
  let tiltOn = false;

  function resize() {
    const wrap = $('game-wrap');
    if (!wrap) return;
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    // Match the visible wrap exactly — never taller than the wrap (avoids clipping the car)
    W = Math.max(160, Math.floor(r.width));
    H = Math.max(80, Math.floor(r.height));
    canvas.width = Math.max(1, Math.floor(W * dpr));
    canvas.height = Math.max(1, Math.floor(H * dpr));
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // Unified road perspective: t=0 far (horizon), t=1 near (by car)
  function roadGeom() {
    // Short canvases (landscape phones): pull horizon up, keep car in lower third but on-screen
    const short = H < 220;
    const top = H * (short ? 0.18 : 0.30);
    const bot = H * (short ? 0.92 : 0.88);
    const topHalf = Math.min(W * 0.14, short ? 90 : 70);
    const botHalf = Math.min(W * 0.42, W * 0.5);
    return { top, bot, topHalf, botHalf, midX: W / 2 };
  }
  function roadY(t, g) {
    g = g || roadGeom();
    t = Math.max(0, Math.min(1, t));
    return g.top + t * (g.bot - g.top);
  }
  function roadHalf(t, g) {
    g = g || roadGeom();
    t = Math.max(0, Math.min(1, t));
    return g.topHalf + t * (g.botHalf - g.topHalf);
  }
  // Lane centers 0/1/2 share the same X mapping for car and gates
  function laneX(lane, t, g) {
    g = g || roadGeom();
    const half = roadHalf(t, g);
    // three equal lanes across full road width (2*half)
    return g.midX + (lane - 1) * ((2 * half) / 3);
  }
  function depthToT(z) {
    // GATE_SPAWN (far) → t≈0.06; GATE_HIT_Z (near) → just above carT
    const u = (GATE_SPAWN - z) / GATE_DIST; // 0 at spawn, 1 at hit
    const near = Math.max(0.55, carT() - 0.10);
    return 0.06 + Math.max(0, Math.min(1, u)) * (near - 0.06);
  }
  function carT() {
    // Slightly higher on short canvases so the full sprite stays visible
    return H < 220 ? 0.78 : 0.86;
  }

  function drawCar(x, y, scale, flashOk) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // body — local units ~ width 48, height 56; drawn centered on axle
    ctx.fillStyle = flashOk ? '#66bb6a' : '#e53935';
    roundRect(-22, -36, 44, 52, 8);
    ctx.fill();
    ctx.fillStyle = '#b71c1c';
    roundRect(-20, -18, 40, 30, 6);
    ctx.fill();
    ctx.fillStyle = '#81d4fa';
    roundRect(-14, -30, 28, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#fff59d';
    ctx.beginPath();
    ctx.arc(-12, -34, 4, 0, Math.PI * 2);
    ctx.arc(12, -34, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#212121';
    roundRect(-26, -22, 9, 14, 2);
    roundRect(17, -22, 9, 14, 2);
    roundRect(-26, 4, 9, 14, 2);
    roundRect(17, 4, 9, 14, 2);
    // nose mark so facing is clear
    ctx.fillStyle = '#ffeb3b';
    ctx.fillRect(-6, -38, 12, 4);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  function drawScene(dt) {
    if (!run) return;
    const g = roadGeom();

    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, g.top + 20);
    sky.addColorStop(0, '#4fc3f7');
    sky.addColorStop(1, '#b3e5fc');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // hills
    const hillOff = (run.roadOffset * 0.15) % W;
    ctx.fillStyle = '#66bb6a';
    ctx.beginPath();
    ctx.moveTo(0, g.top + 8);
    for (let i = 0; i <= 8; i++) {
      const hx = ((i * W) / 6 - hillOff + W) % (W + 40) - 20;
      ctx.quadraticCurveTo(hx + W / 12, g.top - 30 + (i % 2) * 16, hx + W / 6, g.top + 8);
    }
    ctx.lineTo(W, g.top + 16);
    ctx.lineTo(0, g.top + 16);
    ctx.fill();

    // roadside props
    const sideOff = run.roadOffset * 2;
    for (let i = 0; i < 10; i++) {
      const zt = ((i / 10 + sideOff * 0.02) % 1);
      const y = g.top + zt * (g.bot - g.top) * 0.85;
      const sc = 0.35 + zt * 0.9;
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(W * 0.06, y - 18 * sc, 4 * sc, 20 * sc);
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath();
      ctx.arc(W * 0.06 + 2 * sc, y - 26 * sc, 11 * sc, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = i % 2 ? '#78909c' : '#90a4ae';
      ctx.fillRect(W * 0.88, y - 36 * sc, 20 * sc, 38 * sc);
      ctx.fillStyle = '#ffe082';
      ctx.fillRect(W * 0.88 + 4 * sc, y - 28 * sc, 5 * sc, 5 * sc);
    }

    // road trapezoid (matches laneX / roadHalf)
    ctx.fillStyle = '#546e7a';
    ctx.beginPath();
    ctx.moveTo(g.midX - g.topHalf, g.top);
    ctx.lineTo(g.midX + g.topHalf, g.top);
    ctx.lineTo(g.midX + g.botHalf, g.bot);
    ctx.lineTo(g.midX - g.botHalf, g.bot);
    ctx.closePath();
    ctx.fill();
    // asphalt edge lines
    ctx.strokeStyle = '#eceff1';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(g.midX - g.topHalf, g.top);
    ctx.lineTo(g.midX - g.botHalf, g.bot);
    ctx.moveTo(g.midX + g.topHalf, g.top);
    ctx.lineTo(g.midX + g.botHalf, g.bot);
    ctx.stroke();

    // lane dividers at 1/3 and 2/3
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([16, 14]);
    ctx.lineDashOffset = -run.roadOffset * 42;
    ctx.beginPath();
    ctx.moveTo(g.midX - g.topHalf / 3, g.top);
    ctx.lineTo(g.midX - g.botHalf / 3, g.bot);
    ctx.moveTo(g.midX + g.topHalf / 3, g.top);
    ctx.lineTo(g.midX + g.botHalf / 3, g.bot);
    ctx.stroke();
    ctx.setLineDash([]);
    // center dashes
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 18]);
    ctx.lineDashOffset = -run.roadOffset * 50;
    ctx.beginPath();
    ctx.moveTo(g.midX, g.top);
    ctx.lineTo(g.midX, g.bot);
    ctx.stroke();
    ctx.setLineDash([]);

    // answer gates — same laneX as car
    const q = currentGate();
    if (q && !run.gateHit) {
      const tGate = depthToT(run.gateZ);
      const y = roadY(tGate, g);
      const half = roadHalf(tGate, g);
      const laneW = (2 * half) / 3;
      const gw = Math.max(36, Math.min(laneW * 0.85, 90));
      const gh = Math.max(26, gw * 0.62);
      const fontPx = Math.max(13, Math.min(22, gw * 0.38));
      const colors = ['#1e88e5', '#8e24aa', '#e53935'];
      for (let lane = 0; lane < 3; lane++) {
        const x = laneX(lane, tGate, g);
        ctx.save();
        ctx.translate(x, y);
        ctx.fillStyle = '#5d4037';
        ctx.fillRect(-2.5, 0, 5, Math.max(10, gh * 0.55));
        ctx.fillStyle = colors[lane];
        roundRect(-gw / 2, -gh, gw, gh, 7);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + fontPx + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // keep text inside sign
        const label = String(q.options[lane]);
        ctx.fillText(label, 0, -gh / 2, gw - 8);
        ctx.restore();
      }
    }

    // car — bottom of road, scaled to lane width, fully on-canvas
    const ct = carT();
    const cx = laneX(run.carX, ct, g);
    const cy = roadY(ct, g);
    const laneWNear = (2 * roadHalf(ct, g)) / 3;
    // sprite local width ~52px; fit ~55% of lane so it sits clearly inside markers
    const carScale = Math.max(0.55, Math.min(1.25, (laneWNear * 0.55) / 52));
    // ensure full sprite (top ~-36*s, bottom ~+18*s) stays inside canvas
    const carBottomPad = 6;
    const maxY = H - carBottomPad - 18 * carScale;
    const minY = 36 * carScale + 4;
    const adjY = Math.max(minY, Math.min(cy, maxY));
    if (shakeT > 0) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 10 * shakeT, (Math.random() - 0.5) * 6 * shakeT);
    }
    drawCar(cx, adjY, carScale, run.flash && run.flash.kind === 'ok');
    if (shakeT > 0) ctx.restore();

    if (run.flash && run.flash.kind === 'ok' && run.flash.gained) {
      const ft = run.flash.t;
      ctx.fillStyle = 'rgba(46,125,50,' + Math.min(1, ft * 2) + ')';
      ctx.font = 'bold 26px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+' + run.flash.gained, W / 2, H * 0.48 - (0.55 - ft) * 36);
    }
    if (run.flash) {
      ctx.fillStyle =
        run.flash.kind === 'ok'
          ? 'rgba(76,175,80,' + Math.min(0.35, run.flash.t) + ')'
          : 'rgba(244,67,54,' + Math.min(0.35, run.flash.t) + ')';
      ctx.fillRect(0, 0, W, H);
    }
  }

  function itemDuration(level) {
    return ITEM_SEC[level] || 7;
  }

  function startAttempt() {
    return (async () => {
      if (!DEMO) {
        const rec = await fetchRemoteRecord();
        mergeRemote(rec);
        if (progress.attemptsUsed >= MAX_ATTEMPTS) {
          paintLobby();
          return;
        }
      }
      const num = DEMO ? 1 : progress.attemptsUsed + 1;
      attempt = {
        num,
        score: 0,
        unlocked: LEVELS,
        bestLevel: 0,
        totalCorrect: 0,
        active: true,
      };
      Sound.unlock();
      Sound.startMusic(1);
      startLevel(1);
    })();
  }

  function startLevel(level) {
    if (!attempt || !attempt.active) {
      alert('Start an attempt first.');
      return;
    }
    Sound.setLevel(level);
    if (level > 1) Sound.levelUp();
    const questions = IRQuestions.generateLevel(level, ITEMS);
    run = {
      level,
      questions,
      qIndex: 0,
      lives: LIVES,
      correct: 0,
      score: 0,
      streak: 0,
      lane: 1,
      targetLane: 1,
      carX: 1,
      gateZ: GATE_SPAWN,
      gateHit: false,
      itemT: itemDuration(level),
      itemMax: itemDuration(level),
      flash: null,
      roadOffset: 0,
      over: false,
      paused: false,
      lastTs: 0,
      endedByLives: false,
    };
    updateHud();
    show('game');
    resize();
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function updateHud() {
    if (!run) return;
    $('hud-attempt').textContent = MAX_ATTEMPTS === 1 ? '1 try only' : ('Attempt ' + (attempt ? attempt.num : '?') + ' of ' + MAX_ATTEMPTS);
    $('hud-level').textContent = 'L' + run.level;
    $('hud-q').textContent = run.qIndex + 1 + '/' + ITEMS;
    $('hud-score').textContent = String((attempt ? attempt.score : 0) + run.score);
    $('hud-lives').textContent = '❤'.repeat(run.lives) + '♡'.repeat(Math.max(0, LIVES - run.lives));
    const q = run.questions[run.qIndex];
    $('hud-prompt').textContent = q ? q.prompt : '';
    const frac = Math.max(0, Math.min(1, run.itemT / run.itemMax));
    $('timer-bar').style.transform = 'scaleX(' + frac + ')';
    $('timer-label').textContent = run.itemT.toFixed(1) + 's';
  }

  function currentGate() {
    return run && run.questions[run.qIndex] ? run.questions[run.qIndex] : null;
  }

  function hitGate(lane) {
    if (run.gateHit || run.over) return;
    run.gateHit = true;
    const q = currentGate();
    // Same index used when drawing options[lane] at laneX(lane)
    lane = Math.max(0, Math.min(2, lane | 0));
    const chosen = q.options[lane];
    const ok = chosen === q.answer;
    if (ok) {
      run.correct++;
      run.streak++;
      const gained = BASE_PTS[run.level] + Math.floor(run.streak / 3) * 5;
      run.score += gained;
      run.flash = { kind: 'ok', t: 0.55, gained };
      Sound.ding();
    } else {
      run.streak = 0;
      run.lives--;
      run.flash = { kind: 'bad', t: 0.55 };
      shakeT = 0.45;
      Sound.buzz();
      if (run.lives <= 0) {
        run.endedByLives = true;
        endLevel(false);
        return;
      }
    }
    updateHud();
  }

  function advanceQuestion() {
    run.qIndex++;
    run.gateHit = false;
    run.gateZ = GATE_SPAWN;
    run.itemT = itemDuration(run.level);
    run.itemMax = run.itemT;
    if (run.qIndex >= ITEMS) {
      endLevel(true);
      return;
    }
    updateHud();
  }

  function endLevel(finishedAllItems) {
    if (!run || run.over) return;
    run.over = true;
    cancelAnimationFrame(raf);
    if (attempt) {
      attempt.score += run.score;
      attempt.totalCorrect += run.correct;
      attempt.bestLevel = Math.max(attempt.bestLevel, run.level);
    }

    const isLast = run.level >= LEVELS;
    const died = !!run.endedByLives;

    $('sum-title').textContent = isLast
      ? 'Run complete!'
      : died
        ? 'Out of lives — next level'
        : 'Level ' + run.level + ' Clear!';

    $('sum-detail').textContent =
      'Correct: ' +
      run.correct +
      '/' +
      (died ? run.qIndex + 1 : ITEMS) +
      ' · Level points: ' +
      run.score +
      ' · Attempt total: ' +
      (attempt ? attempt.score : 0) +
      (died && !isLast ? ' · Fresh 3 lives on next level' : '') +
      (isLast ? ' · All 5 levels done' : '');

    if (isLast) {
      finishAttempt().then(() => paintSummaryButtons(false));
    } else {
      $('sum-sync').textContent =
        (MAX_ATTEMPTS === 1 ? '1 try' : ('Attempt ' + attempt.num + ' of ' + MAX_ATTEMPTS)) + ' · Level ' + (run.level + 1) + ' next.';
      paintSummaryButtons(true);
    }
    show('summary');
  }

  async function finishAttempt() {
    if (!attempt || !attempt.active) return;
    attempt.active = false;
    Sound.stopMusic();
    const score = attempt.score;
    const bestLevel = attempt.bestLevel;
    if (DEMO) {
      $('sum-sync').textContent = 'Demo mode — score not saved (' + score + ' pts).';
      return;
    }
    progress.attemptsUsed = Math.max(progress.attemptsUsed + 1, attempt.num);
    progress.attemptScores = (progress.attemptScores || []).concat([score]);
    progress.bestTotal = Math.max(progress.bestTotal, score);
    progress.bestLevel = Math.max(progress.bestLevel, bestLevel);
    saveLocal();

    const entry = {
      name: player.name,
      grade: player.grade,
      section: player.section || '',
      total: progress.bestTotal,
      bestLevel: progress.bestLevel,
      attempts: progress.attemptsUsed,
      attemptScores: progress.attemptScores.slice(-4),
      correct: attempt.totalCorrect,
      ts: Date.now(),
    };
    $('sum-sync').textContent = 'Saving best score…';
    const ok = await submitRecord(entry);
    $('sum-sync').textContent = ok
      ? 'Saved. Your score: ' + progress.bestTotal + ' · Tries used: ' + progress.attemptsUsed + '/' + MAX_ATTEMPTS
      : 'Saved on this phone. Score: ' + progress.bestTotal + ' · Tries: ' + progress.attemptsUsed + '/' + MAX_ATTEMPTS;
  }

  function paintSummaryButtons(canNext) {
    const left = MAX_ATTEMPTS - progress.attemptsUsed;
    $('btn-next').style.display = canNext ? '' : 'none';
    $('btn-next').textContent = 'Next Level';
    if (!canNext && left > 0) {
      $('btn-retry').style.display = '';
      $('btn-retry').textContent = MAX_ATTEMPTS === 1 ? 'Start Run (1 try)' : ('Start Attempt ' + (progress.attemptsUsed + 1) + ' of ' + MAX_ATTEMPTS);
    } else {
      $('btn-retry').style.display = 'none';
    }
    $('btn-menu').style.display = '';
    $('btn-menu').textContent = 'Back';
  }

  function loop(ts) {
    if (!run || run.over) return;
    if (!run.lastTs) run.lastTs = ts;
    let dt = Math.min(0.05, (ts - run.lastTs) / 1000);
    run.lastTs = ts;

    // smooth lane
    run.carX += (run.targetLane - run.carX) * Math.min(1, dt * 12);

    // road scroll (visual only) — proportional to level pace
    const visualSpeed = 2.2 + run.level * 0.25;
    run.roadOffset += visualSpeed * dt;

    if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);

    if (run.flash) {
      run.flash.t -= dt;
      if (run.flash.t <= 0) {
        const wasHit = run.gateHit;
        run.flash = null;
        if (wasHit && !run.over) advanceQuestion();
      }
    } else if (!run.gateHit) {
      // Exact timing: deplete itemT and move gateZ in sync
      run.itemT -= dt;
      const fracLeft = Math.max(0, run.itemT / run.itemMax);
      run.gateZ = GATE_HIT_Z + GATE_DIST * fracLeft;
      if (run.itemT <= 0 || run.gateZ <= GATE_HIT_Z) {
        // Use the lane the learner chose (targetLane), not Math.round(carX).
        // Rounding mid-slide scored the wrong gate while the car was still moving —
        // e.g. pressing ◀ toward the correct answer but registering the middle option.
        run.carX = run.targetLane;
        run.lane = run.targetLane;
        hitGate(run.targetLane);
      }
      updateHud();
    }

    drawScene(dt);
    raf = requestAnimationFrame(loop);
  }

  // controls
  function setLane(n) {
    if (!run || run.over) return;
    run.targetLane = Math.max(0, Math.min(2, n));
  }
  $('btn-left').onclick = () => setLane(0);
  $('btn-mid').onclick = () => setLane(1);
  $('btn-right').onclick = () => setLane(2);

  let touchX0 = 0;
  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches[0]) touchX0 = e.touches[0].clientX;
    },
    { passive: true }
  );
  canvas.addEventListener(
    'touchend',
    (e) => {
      const t = e.changedTouches[0];
      if (!t || !run) return;
      const dx = t.clientX - touchX0;
      if (Math.abs(dx) > 30) setLane(run.targetLane + (dx > 0 ? 1 : -1));
    },
    { passive: true }
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a') setLane((run && run.targetLane) - 1);
    if (e.key === 'ArrowRight' || e.key === 'd') setLane((run && run.targetLane) + 1);
    if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 's') setLane(1);
  });

  $('chk-tilt').onchange = (e) => {
    tiltOn = e.target.checked;
    if (tiltOn && window.DeviceOrientationEvent && DeviceOrientationEvent.requestPermission) {
      DeviceOrientationEvent.requestPermission().catch(() => {});
    }
  };
  window.addEventListener('deviceorientation', (e) => {
    if (!tiltOn || !run || run.over) return;
    const g = e.gamma;
    if (g == null) return;
    if (g < -12) run.targetLane = 0;
    else if (g > 12) run.targetLane = 2;
    else run.targetLane = 1;
  });

  function paintLobby() {
    $('levels-wrap').style.display = '';
    const left = MAX_ATTEMPTS - progress.attemptsUsed;
    $('player-label').textContent =
      player.name +
      ' · G' +
      player.grade +
      (player.section ? ' · ' + player.section : '') +
      ' · Best: ' +
      progress.bestTotal;
    const box = $('level-btns');
    box.innerHTML = '';
    if (left <= 0) {
      const msg = document.createElement('div');
      msg.className = 'no-tries';
      msg.innerHTML =
        '<strong>No tries left</strong><br>Your score: <b>' +
        progress.bestTotal +
        '</b>' +
        (progress.bestLevel ? ' (reached L' + progress.bestLevel + ')' : '') +
        '<br><span class="note" style="opacity:1;color:#b71c1c">That score is on the leaderboard.</span>';
      box.appendChild(msg);
      return;
    }
    const b = document.createElement('button');
    b.className = 'lvl';
    b.textContent = MAX_ATTEMPTS === 1 ? 'Start Run (1 try)' : ('Start Attempt ' + (progress.attemptsUsed + 1) + ' of ' + MAX_ATTEMPTS);
    b.onclick = () => startAttempt();
    box.appendChild(b);
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent =
      '1 try only · Levels 1→5 (fresh lives each level) · Your score goes on the leaderboard';
    box.appendChild(hint);
  }

  $('btn-play').onclick = async () => {
    const name = $('inp-name').value.trim();
    const grade = $('inp-grade').value;
    const section = $('inp-section').value.trim();
    if (!name || !grade || !section) {
      alert('Select Grade, Section, and your Name from the list.');
      return;
    }
    // Must be on master list
    const ok = learners.some((x) => x.n === name && gradeNum(x.g) === grade && x.s === section);
    if (!ok) {
      alert('Name not on the class list.');
      return;
    }
    player = { name, grade, section };
    localStorage.setItem('ir-name', name);
    localStorage.setItem('ir-grade', grade);
    localStorage.setItem('ir-section', section);
    progress = blankProgress();
    loadLocal();
    $('btn-play').disabled = true;
    $('btn-play').textContent = 'Checking tries…';
    const rec = await fetchRemoteRecord();
    mergeRemote(rec);
    $('btn-play').disabled = false;
    $('btn-play').textContent = 'Continue';
    paintLobby();
  };

  $('btn-go-board').onclick = async () => {
    show('board');
    $('board-body').innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    renderBoard(await fetchBoard(), $('board-filter').value);
  };
  $('board-filter').onchange = async () => {
    renderBoard(await fetchBoard(), $('board-filter').value);
  };
  $('btn-board-back').onclick = () => show('start');

  $('btn-next').onclick = () => {
    if (attempt && attempt.active && run) startLevel(run.level + 1);
  };
  $('btn-retry').onclick = () => startAttempt();
  $('btn-menu').onclick = () => {
    if (run && !run.over && attempt && attempt.active) {
      run.over = true;
      cancelAnimationFrame(raf);
      attempt.score += run.score;
      finishAttempt().then(() => {
        show('start');
        paintLobby();
      });
      return;
    }
    show('start');
    paintLobby();
  };

  window.__IR_TEST__ = {
    Sound,
    DEMO,
    ITEM_SEC,
    GATE_SPAWN,
    GATE_HIT_Z,
    GATE_DIST,
    get CAR_T() { return carT(); },
    carT,
    MAX_ATTEMPTS,
    LEVELS,
    ITEMS,
    getProgress: () => progress,
    getAttempt: () => attempt,
    getRun: () => run,
    getLearners: () => learners,
    itemDuration,
    roadGeom,
    laneX,
    roadY,
    depthToT,
    hitGate,
    setLane,
    currentGate,
    forceDemoStart: (level) => {
      player = player.name ? player : { name: 'Demo Driver', grade: '11', section: 'TEST' };
      attempt = {
        num: 1,
        score: 0,
        unlocked: LEVELS,
        bestLevel: 0,
        totalCorrect: 0,
        active: true,
      };
      Sound.unlock();
      startLevel(level || 1);
    },
  };

  // Auto-demo entry for headless tests
  if (DEMO) {
    $('load-status').textContent = 'Demo mode — scores not saved.';
    // Kick into gameplay once learners (or timeout) settle — no real attempt used
    const kick = () => {
      try { window.__IR_TEST__.forceDemoStart(1); } catch (e) {}
    };
    const waitLearners = setInterval(() => {
      if (learners && learners.length) {
        clearInterval(waitLearners);
        kick();
      }
    }, 200);
    setTimeout(() => { clearInterval(waitLearners); kick(); }, 4000);
  }

  loadLearners();
  Sound.paintBtn();
  const btnSound = $('btn-sound');
  if (btnSound) btnSound.onclick = () => Sound.toggle();
  function onViewportChange() {
    if (screens.game.classList.contains('active')) {
      resize();
    }
  }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', () => setTimeout(onViewportChange, 120));
  show('start');
})();
