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
  const MAX_ATTEMPTS = 2;
  const BASE_PTS = [0, 10, 20, 30, 40, 50];
  // Exact-ish seconds from spawn until gate hit, per level
  const ITEM_SEC = [0, 8, 7, 6, 6, 7];
  const GATE_SPAWN = 1.4;
  const GATE_HIT_Z = 0.12;
  const GATE_DIST = GATE_SPAWN - GATE_HIT_Z;
  const MAX_PLAUSIBLE = 5000;

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

  function renderBoard(entries, filter) {
    const tb = $('board-body');
    tb.innerHTML = '';
    let list = entries.slice();
    if (filter === '11') list = list.filter((e) => String(e.grade) === '11');
    if (filter === '12') list = list.filter((e) => String(e.grade) === '12');
    list.sort((a, b) => Number(b.total) - Number(a.total) || Number(b.bestLevel) - Number(a.bestLevel));
    if (!list.length) {
      tb.innerHTML = '<tr><td colspan="5" class="muted">No scores yet. Be the first!</td></tr>';
      return;
    }
    list.slice(0, 100).forEach((e, i) => {
      const tr = document.createElement('tr');
      tr.innerHTML =
        '<td>' +
        (i + 1) +
        '</td><td>' +
        esc(e.name) +
        '</td><td>G' +
        esc(e.grade) +
        '</td><td>' +
        Number(e.total) +
        '</td><td>L' +
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
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(280, Math.floor(r.width));
    H = Math.max(320, Math.floor(r.height));
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function laneX(lane, z) {
    const perspective = 1 / (0.35 + z * 1.1);
    const roadW = W * 0.85 * perspective;
    const cx = W / 2;
    return cx + ((lane - 1) * roadW) / 3;
  }

  function drawCar(x, y, scale, flashOk) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // body
    ctx.fillStyle = flashOk ? '#66bb6a' : '#e53935';
    roundRect(-22, -28, 44, 50, 8);
    ctx.fill();
    ctx.fillStyle = '#b71c1c';
    roundRect(-20, -10, 40, 28, 6);
    ctx.fill();
    // cabin
    ctx.fillStyle = '#81d4fa';
    roundRect(-14, -22, 28, 16, 4);
    ctx.fill();
    // headlights
    ctx.fillStyle = '#fff59d';
    ctx.beginPath();
    ctx.arc(-12, -26, 4, 0, Math.PI * 2);
    ctx.arc(12, -26, 4, 0, Math.PI * 2);
    ctx.fill();
    // wheels
    ctx.fillStyle = '#212121';
    roundRect(-24, -18, 8, 14, 2);
    roundRect(16, -18, 8, 14, 2);
    roundRect(-24, 8, 8, 14, 2);
    roundRect(16, 8, 8, 14, 2);
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawScene(dt) {
    if (!run) return;
    // sky
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.45);
    sky.addColorStop(0, '#4fc3f7');
    sky.addColorStop(1, '#b3e5fc');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // distant hills (parallax)
    const hillOff = (run.roadOffset * 0.15) % W;
    ctx.fillStyle = '#66bb6a';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.42);
    for (let i = 0; i <= 8; i++) {
      const hx = ((i * W) / 6 - hillOff + W) % (W + 40) - 20;
      ctx.quadraticCurveTo(hx + W / 12, H * 0.28 + (i % 2) * 18, hx + W / 6, H * 0.42);
    }
    ctx.lineTo(W, H * 0.45);
    ctx.lineTo(0, H * 0.45);
    ctx.fill();

    // roadside trees/buildings (simple)
    const sideOff = run.roadOffset * 2;
    for (let i = 0; i < 10; i++) {
      const z = ((i / 10 + sideOff * 0.02) % 1);
      const persp = 1 / (0.4 + z * 2.2);
      const y = H * 0.38 + z * H * 0.5;
      const sx = 14 * persp;
      // left tree
      ctx.fillStyle = '#5d4037';
      ctx.fillRect(W * 0.08 - sx, y - 20 * persp, 4 * persp, 22 * persp);
      ctx.fillStyle = '#2e7d32';
      ctx.beginPath();
      ctx.arc(W * 0.08 - sx + 2 * persp, y - 28 * persp, 12 * persp, 0, Math.PI * 2);
      ctx.fill();
      // right building
      ctx.fillStyle = i % 2 ? '#78909c' : '#90a4ae';
      ctx.fillRect(W * 0.88, y - 40 * persp, 22 * persp, 42 * persp);
      ctx.fillStyle = '#ffe082';
      ctx.fillRect(W * 0.88 + 4 * persp, y - 32 * persp, 5 * persp, 5 * persp);
    }

    // road trapezoid
    const roadTop = H * 0.38;
    ctx.fillStyle = '#455a64';
    ctx.beginPath();
    ctx.moveTo(W * 0.35, roadTop);
    ctx.lineTo(W * 0.65, roadTop);
    ctx.lineTo(W * 0.98, H);
    ctx.lineTo(W * 0.02, H);
    ctx.closePath();
    ctx.fill();

    // lane markings
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.setLineDash([18, 16]);
    ctx.lineDashOffset = -run.roadOffset * 40;
    ctx.beginPath();
    ctx.moveTo(W * 0.45, roadTop);
    ctx.lineTo(W * 0.35, H);
    ctx.moveTo(W * 0.55, roadTop);
    ctx.lineTo(W * 0.65, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // yellow center dashes softer
    ctx.strokeStyle = '#f5c518';
    ctx.lineWidth = 2;
    ctx.setLineDash([12, 20]);
    ctx.lineDashOffset = -run.roadOffset * 50;
    ctx.beginPath();
    ctx.moveTo(W / 2, roadTop);
    ctx.lineTo(W / 2, H);
    ctx.stroke();
    ctx.setLineDash([]);

    // answer gates
    const q = currentGate();
    if (q && !run.gateHit) {
      const z = run.gateZ;
      const persp = 1 / (0.35 + z * 1.1);
      const y = roadTop + (1 - Math.min(1, (z - GATE_HIT_Z) / GATE_DIST)) * (H * 0.48);
      const colors = ['#42a5f5', '#ab47bc', '#ef5350'];
      for (let lane = 0; lane < 3; lane++) {
        const x = laneX(lane, z);
        const gw = 52 * persp;
        const gh = 36 * persp;
        ctx.save();
        ctx.translate(x, y);
        // sign post
        ctx.fillStyle = '#795548';
        ctx.fillRect(-2, 0, 4, 28 * persp);
        // sign board
        ctx.fillStyle = colors[lane];
        roundRect(-gw / 2, -gh, gw, gh, 6 * persp);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2 * persp;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold ' + Math.max(11, 18 * persp) + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(q.options[lane]), 0, -gh / 2);
        ctx.restore();
      }
    }

    // car
    const carLane = run.carX;
    const cx = laneX(carLane, GATE_HIT_Z + 0.02);
    const cy = H * 0.82;
    if (shakeT > 0) {
      ctx.save();
      ctx.translate((Math.random() - 0.5) * 10 * shakeT, (Math.random() - 0.5) * 6 * shakeT);
    }
    drawCar(cx, cy, 1.15, run.flash && run.flash.kind === 'ok');
    if (shakeT > 0) ctx.restore();

    // +points popup
    if (run.flash && run.flash.kind === 'ok' && run.flash.gained) {
      const t = run.flash.t;
      ctx.fillStyle = 'rgba(46,125,50,' + Math.min(1, t * 2) + ')';
      ctx.font = 'bold 28px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('+' + run.flash.gained, W / 2, H * 0.55 - (0.55 - t) * 40);
    }
    // green/red flash overlay
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
      const rec = await fetchRemoteRecord();
      mergeRemote(rec);
      if (progress.attemptsUsed >= MAX_ATTEMPTS) {
        paintLobby();
        return;
      }
      const num = progress.attemptsUsed + 1;
      attempt = {
        num,
        score: 0,
        unlocked: LEVELS,
        bestLevel: 0,
        totalCorrect: 0,
        active: true,
      };
      startLevel(1);
    })();
  }

  function startLevel(level) {
    if (!attempt || !attempt.active) {
      alert('Start an attempt first.');
      return;
    }
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
    $('hud-attempt').textContent = 'Attempt ' + (attempt ? attempt.num : '?') + ' of ' + MAX_ATTEMPTS;
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
    const chosen = q.options[lane];
    const ok = chosen === q.answer;
    if (ok) {
      run.correct++;
      run.streak++;
      const gained = BASE_PTS[run.level] + Math.floor(run.streak / 3) * 5;
      run.score += gained;
      run.flash = { kind: 'ok', t: 0.55, gained };
    } else {
      run.streak = 0;
      run.lives--;
      run.flash = { kind: 'bad', t: 0.55 };
      shakeT = 0.45;
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
        'Attempt ' + attempt.num + ' of ' + MAX_ATTEMPTS + ' · Level ' + (run.level + 1) + ' next.';
      paintSummaryButtons(true);
    }
    show('summary');
  }

  async function finishAttempt() {
    if (!attempt || !attempt.active) return;
    attempt.active = false;
    const score = attempt.score;
    const bestLevel = attempt.bestLevel;
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
      ? 'Saved. Best of your tries: ' +
        progress.bestTotal +
        ' · Attempts used: ' +
        progress.attemptsUsed +
        '/' +
        MAX_ATTEMPTS
      : 'Saved on this phone. Best: ' +
        progress.bestTotal +
        ' · Attempts: ' +
        progress.attemptsUsed +
        '/' +
        MAX_ATTEMPTS;
  }

  function paintSummaryButtons(canNext) {
    const left = MAX_ATTEMPTS - progress.attemptsUsed;
    $('btn-next').style.display = canNext ? '' : 'none';
    $('btn-next').textContent = 'Next Level';
    if (!canNext && left > 0) {
      $('btn-retry').style.display = '';
      $('btn-retry').textContent = 'Start Attempt ' + (progress.attemptsUsed + 1) + ' of ' + MAX_ATTEMPTS;
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
        hitGate(Math.round(run.carX));
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
        '<strong>No tries left</strong><br>You used both attempts.<br>Your best score: <b>' +
        progress.bestTotal +
        '</b>' +
        (progress.bestLevel ? ' (reached L' + progress.bestLevel + ')' : '') +
        '<br><span class="note" style="opacity:1;color:#b71c1c">Highest of your 2 tries is on the leaderboard.</span>';
      box.appendChild(msg);
      return;
    }
    const b = document.createElement('button');
    b.className = 'lvl';
    b.textContent = 'Start Attempt ' + (progress.attemptsUsed + 1) + ' of ' + MAX_ATTEMPTS;
    b.onclick = () => startAttempt();
    box.appendChild(b);
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent =
      left +
      ' try' +
      (left > 1 ? 's' : '') +
      ' left · One attempt = Levels 1→5 (fresh lives each level) · Highest score counts';
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
    ITEM_SEC,
    GATE_SPAWN,
    GATE_HIT_Z,
    GATE_DIST,
    MAX_ATTEMPTS,
    LEVELS,
    ITEMS,
    getProgress: () => progress,
    getAttempt: () => attempt,
    getRun: () => run,
    getLearners: () => learners,
    itemDuration,
  };

  loadLearners();
  window.addEventListener('resize', () => {
    if (screens.game.classList.contains('active')) resize();
  });
  show('start');
})();
