/* Integer Racer — canvas runner. Mobile-first, low-data. */
(function () {
  'use strict';

  const API_NS = 'bnhs-iracer-nov2026';
  const API = 'https://mantledb.sh/v2/' + API_NS;
  const API_EXPORT = 'https://mantledb.sh/v2/export/' + API_NS;
  const GAS_URL = '';

  const LEVELS = 5;
  const ITEMS = 20;
  const LIVES = 3;
  const UNLOCK_MIN = 12;
  const MAX_ATTEMPTS = 2;
  const BASE_PTS = [0, 10, 20, 30, 40, 50];
  // ~45% slower than original L1; L5 ≈ former L2–L3. Gentle rise only.
  const BASE_SPEED = [0, 1.05, 1.25, 1.45, 1.65, 1.85];
  const GATE_SPAWN = 1.45; // farther = more reading time
  const GATE_HIT_Z = 0.12;
  const GATE_APPROACH = 0.10; // was 0.22
  const MAX_PLAUSIBLE = 4000;

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

  let player = { name: '', grade: '11', section: '' };
  // attemptsUsed = completed attempts (0–2). bestTotal = best of those.
  let progress = blankProgress();
  let run = null;
  let attempt = null; // { num, score, unlocked, bestLevel, totalCorrect, active }
  let raf = 0;
  let remoteRecord = null;

  function blankProgress() {
    return {
      attemptsUsed: 0,
      bestTotal: 0,
      bestLevel: 0,
      attemptScores: [],
    };
  }

  function keyOf(p) {
    return norm(p.name) + '-g' + String(p.grade);
  }
  function norm(s) {
    return (
      String(s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 48) || 'anon'
    );
  }

  function loadLocal() {
    try {
      const raw = localStorage.getItem('ir-progress-' + keyOf(player));
      if (raw) {
        const p = JSON.parse(raw);
        progress.attemptsUsed = Math.max(0, Number(p.attemptsUsed) || 0);
        progress.bestTotal = Math.max(0, Number(p.bestTotal) || Number(p.totals) || 0);
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
      if (GAS_URL) {
        const r = await fetch(GAS_URL + '?action=record&name=' + encodeURIComponent(player.name) + '&grade=' + encodeURIComponent(player.grade));
        return await r.json();
      }
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
    const remAttempts = Math.max(0, Number(rec.attempts) || 0);
    const remTotal = Math.max(0, Number(rec.total) || 0);
    const remLevel = Math.max(0, Number(rec.bestLevel) || 0);
    progress.attemptsUsed = Math.max(progress.attemptsUsed, remAttempts);
    progress.bestTotal = Math.max(progress.bestTotal, remTotal);
    progress.bestLevel = Math.max(progress.bestLevel, remLevel);
    if (Array.isArray(rec.attemptScores) && rec.attemptScores.length) {
      const set = new Set(progress.attemptScores.concat(rec.attemptScores.map(Number)));
      progress.attemptScores = [...set].filter((n) => Number.isFinite(n));
    }
    saveLocal();
  }

  async function fetchBoard() {
    try {
      if (GAS_URL) {
        const r = await fetch(GAS_URL + '?action=board');
        const j = await r.json();
        return Array.isArray(j.entries) ? j.entries : [];
      }
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
    // Local board mirror
    const local = JSON.parse(localStorage.getItem('ir-local-board') || '[]');
    const idx = local.findIndex((e) => norm(e.name) === norm(entry.name) && String(e.grade) === String(entry.grade));
    if (idx >= 0) local[idx] = entry;
    else local.push(entry);
    localStorage.setItem('ir-local-board', JSON.stringify(local));

    try {
      if (GAS_URL) {
        await fetch(GAS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({ action: 'submit', ...entry }),
        });
        return true;
      }
      const path = API + '/scores/' + keyOf(entry);
      let best = Object.assign({}, entry);
      try {
        const prev = await (await fetch(path + '?t=' + Date.now())).json();
        if (prev && prev.name) {
          best.total = Math.max(Number(prev.total) || 0, Number(entry.total) || 0);
          best.bestLevel = Math.max(Number(prev.bestLevel) || 0, Number(entry.bestLevel) || 0);
          best.attempts = Math.max(Number(prev.attempts) || 0, Number(entry.attempts) || 0);
          const scores = []
            .concat(Array.isArray(prev.attemptScores) ? prev.attemptScores : [])
            .concat(Array.isArray(entry.attemptScores) ? entry.attemptScores : [])
            .map(Number)
            .filter((n) => Number.isFinite(n));
          best.attemptScores = [...new Set(scores)].slice(-4);
          // Prefer higher total's name casing from whoever set the best
          if ((Number(prev.total) || 0) > (Number(entry.total) || 0)) {
            best.name = prev.name;
            best.section = prev.section || entry.section;
          }
        }
      } catch (e) {}
      if (Number(best.total) > MAX_PLAUSIBLE) return false;
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
        '<td>' + (i + 1) + '</td><td>' + esc(e.name) + '</td><td>G' + esc(e.grade) +
        '</td><td>' + Number(e.total) + '</td><td>L' + Number(e.bestLevel || 0) + '</td>';
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

  // ---- Canvas ----
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  let W = 360, H = 640;
  let tiltOn = false;

  function resize() {
    const wrap = $('game-wrap');
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = Math.max(280, Math.floor(r.width));
    H = Math.max(420, Math.floor(r.height));
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function levelSpeed(level, qIndex) {
    return BASE_SPEED[level] + Math.min(0.35, (qIndex || 0) * 0.012);
  }

  function startAttempt() {
    if (progress.attemptsUsed >= MAX_ATTEMPTS) {
      paintLobby();
      return;
    }
    const num = progress.attemptsUsed + 1;
    attempt = {
      num,
      score: 0,
      unlocked: 1,
      bestLevel: 0,
      totalCorrect: 0,
      active: true,
    };
    startLevel(1);
  }

  function startLevel(level) {
    if (!attempt || !attempt.active) {
      alert('Start an attempt first.');
      return;
    }
    if (level > attempt.unlocked) {
      alert('Need ' + UNLOCK_MIN + '/' + ITEMS + ' correct to unlock the next level.');
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
      speed: levelSpeed(level, 0),
      gateZ: GATE_SPAWN,
      gateHit: false,
      flash: null,
      roadOffset: 0,
      over: false,
      paused: false,
      lastTs: 0,
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
  }

  function currentGate() {
    const q = run.questions[run.qIndex];
    return q || null;
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
      if (run.lives <= 0) {
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
    run.speed = levelSpeed(run.level, run.qIndex);
    if (run.qIndex >= ITEMS) {
      endLevel(true);
      return;
    }
    updateHud();
  }

  function endLevel(finished) {
    if (!run || run.over) return;
    run.over = true;
    cancelAnimationFrame(raf);
    const passed = finished && run.correct >= UNLOCK_MIN;
    if (attempt) {
      attempt.score += run.score;
      attempt.totalCorrect += run.correct;
      if (run.correct > 0 || finished) attempt.bestLevel = Math.max(attempt.bestLevel, run.level);
      if (passed && run.level < LEVELS) attempt.unlocked = Math.max(attempt.unlocked, run.level + 1);
      if (passed && run.level === LEVELS) attempt.unlocked = LEVELS;
    }

    const attemptOver = !passed || (passed && run.level === LEVELS);
    // !finished (died) OR finished but not enough to unlock → attempt ends
    // finished + passed + not L5 → continue same attempt

    $('sum-title').textContent = !finished
      ? 'Out of lives'
      : passed
        ? run.level === LEVELS
          ? 'All 5 levels cleared!'
          : 'Level ' + run.level + ' Clear!'
        : 'Level ' + run.level + ' Done';

    $('sum-detail').textContent =
      'Correct: ' + run.correct + '/' + ITEMS +
      ' · Level points: ' + run.score +
      ' · Attempt total: ' + (attempt ? attempt.score : 0) +
      (!finished ? ' · Attempt over' : '') +
      (finished && !passed ? ' · Need ' + UNLOCK_MIN + '/' + ITEMS + ' to continue · Attempt over' : '') +
      (finished && passed && run.level < LEVELS ? ' · Next level unlocked' : '');

    if (attemptOver) {
      finishAttempt().then(() => paintSummaryButtons(false, false));
    } else {
      $('sum-sync').textContent = 'Attempt ' + attempt.num + ' of ' + MAX_ATTEMPTS + ' still going.';
      paintSummaryButtons(true, false);
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
      ? 'Saved. Best of your tries: ' + progress.bestTotal + ' · Attempts used: ' + progress.attemptsUsed + '/' + MAX_ATTEMPTS
      : 'Saved on this phone. Best: ' + progress.bestTotal + ' · Attempts: ' + progress.attemptsUsed + '/' + MAX_ATTEMPTS;
  }

  function paintSummaryButtons(canNext, _unused) {
    const left = MAX_ATTEMPTS - progress.attemptsUsed;
    $('btn-next').style.display = canNext ? '' : 'none';
    $('btn-next').textContent = 'Next Level';
    // Retry = start next attempt if any left and current attempt ended
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
    if (run.paused) {
      raf = requestAnimationFrame(loop);
      return;
    }
    run.carX += (run.targetLane - run.carX) * Math.min(1, dt * 12);
    run.lane = Math.round(run.carX);
    run.roadOffset = (run.roadOffset + run.speed * dt * 1.2) % 1;
    if (!run.gateHit) {
      run.gateZ -= run.speed * dt * GATE_APPROACH;
      if (run.gateZ <= GATE_HIT_Z) hitGate(Math.round(run.carX));
    } else if (run.flash) {
      run.flash.t -= dt;
      if (run.flash.t <= 0) {
        run.flash = null;
        advanceQuestion();
      }
    }
    draw();
    raf = requestAnimationFrame(loop);
  }

  function project(lane, z) {
    const horizon = H * 0.28;
    const nearY = H * 0.92;
    const y = horizon + (nearY - horizon) * (1 - z);
    const roadNearW = W * 0.92;
    const roadFarW = W * 0.18;
    const roadW = roadFarW + (roadNearW - roadFarW) * (1 - z);
    const laneWidth = roadW / 3;
    const x = W / 2 - roadW / 2 + laneWidth * (lane + 0.5);
    return { x, y, s: 0.25 + 0.75 * (1 - z), roadW, laneWidth };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#87c6ef');
    g.addColorStop(0.35, '#c9e7a5');
    g.addColorStop(1, '#5a8f3c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    const near = project(1, 0);
    const far = project(1, 1);
    ctx.beginPath();
    ctx.moveTo(W / 2 - far.roadW / 2, far.y);
    ctx.lineTo(W / 2 + far.roadW / 2, far.y);
    ctx.lineTo(W / 2 + near.roadW / 2, near.y);
    ctx.lineTo(W / 2 - near.roadW / 2, near.y);
    ctx.closePath();
    ctx.fillStyle = '#3d3d42';
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    for (let laneEdge = 1; laneEdge <= 2; laneEdge++) {
      ctx.beginPath();
      for (let z = 0; z <= 1.001; z += 0.05) {
        const p = project(0, z);
        const x = W / 2 - p.roadW / 2 + (p.roadW / 3) * laneEdge;
        if (z === 0) ctx.moveTo(x, p.y);
        else ctx.lineTo(x, p.y);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = '#f5c518';
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    const midZ0 = run.roadOffset % 1;
    for (let i = 0; i < 8; i++) {
      const z1 = Math.min(1, (i + midZ0) / 8);
      const z2 = Math.min(1, (i + 0.4 + midZ0) / 8);
      const a = project(1, z1);
      const b = project(1, z2);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const q = currentGate();
    if (q && run.gateZ > 0) {
      for (let lane = 0; lane < 3; lane++) {
        const p = project(lane, Math.max(0, run.gateZ));
        const bw = p.laneWidth * 0.82;
        const bh = 36 * p.s + 18;
        ctx.fillStyle = run.gateHit
          ? run.flash && run.flash.kind === 'ok' && Math.round(run.carX) === lane
            ? '#2e7d32'
            : run.flash && run.flash.kind === 'bad' && Math.round(run.carX) === lane
              ? '#c62828'
              : 'rgba(255,255,255,0.35)'
          : '#fff8e1';
        roundRect(p.x - bw / 2, p.y - bh, bw, bh, 8);
        ctx.fill();
        ctx.strokeStyle = '#062a1f';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#062a1f';
        ctx.font = 'bold ' + Math.floor(16 * p.s + 10) + 'px system-ui,sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(q.options[lane]), p.x, p.y - bh / 2);
      }
    }

    const cp = project(run.carX, 0.02);
    drawCar(cp.x, cp.y - 10, 1);

    if (run.flash) {
      ctx.fillStyle = run.flash.kind === 'ok' ? 'rgba(46,125,50,0.85)' : 'rgba(198,40,40,0.85)';
      ctx.fillRect(0, H * 0.38, W, 48);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(
        run.flash.kind === 'ok' ? 'CORRECT! +' + (run.flash.gained || BASE_PTS[run.level]) : 'MISS! Keep going',
        W / 2,
        H * 0.38 + 28
      );
    }
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

  function drawCar(x, y, s) {
    const w = 54 * s, h = 78 * s;
    ctx.fillStyle = '#e53935';
    roundRect(x - w / 2, y - h, w, h, 10);
    ctx.fill();
    ctx.fillStyle = '#bbdefb';
    roundRect(x - w * 0.32, y - h * 0.78, w * 0.64, h * 0.28, 6);
    ctx.fill();
    ctx.fillStyle = '#fff59d';
    ctx.fillRect(x - w * 0.38, y - h * 0.12, w * 0.2, h * 0.08);
    ctx.fillRect(x + w * 0.18, y - h * 0.12, w * 0.2, h * 0.08);
    ctx.fillStyle = '#111';
    ctx.fillRect(x - w * 0.55, y - h * 0.35, w * 0.12, h * 0.22);
    ctx.fillRect(x + w * 0.43, y - h * 0.35, w * 0.12, h * 0.22);
    ctx.fillRect(x - w * 0.55, y - h * 0.85, w * 0.12, h * 0.22);
    ctx.fillRect(x + w * 0.43, y - h * 0.85, w * 0.12, h * 0.22);
  }

  function steer(dir) {
    if (!run || run.over) return;
    run.targetLane = Math.max(0, Math.min(2, run.targetLane + dir));
  }

  let touchX0 = null;
  canvas.addEventListener(
    'touchstart',
    (e) => {
      if (!e.changedTouches[0]) return;
      touchX0 = e.changedTouches[0].clientX;
      e.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    'touchend',
    (e) => {
      if (touchX0 == null || !e.changedTouches[0]) return;
      const dx = e.changedTouches[0].clientX - touchX0;
      const x = e.changedTouches[0].clientX;
      const rect = canvas.getBoundingClientRect();
      if (Math.abs(dx) > 30) steer(dx > 0 ? 1 : -1);
      else steer(x < rect.left + rect.width / 2 ? -1 : 1);
      touchX0 = null;
      e.preventDefault();
    },
    { passive: false }
  );
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') steer(-1);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') steer(1);
  });
  $('btn-left').onclick = () => steer(-1);
  $('btn-right').onclick = () => steer(1);
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

  // ---- Lobby / attempts UI ----
  function paintLobby() {
    $('levels-wrap').style.display = '';
    const left = MAX_ATTEMPTS - progress.attemptsUsed;
    const label =
      player.name +
      ' · G' +
      player.grade +
      (player.section ? ' · ' + player.section : '') +
      ' · Best: ' +
      progress.bestTotal;
    $('player-label').textContent = label;
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
        '<br><span class="note" style="opacity:1">Highest of your 2 tries is on the leaderboard.</span>';
      box.appendChild(msg);
      return;
    }
    const b = document.createElement('button');
    b.className = 'lvl';
    b.style.gridColumn = '1 / -1';
    b.textContent = 'Start Attempt ' + (progress.attemptsUsed + 1) + ' of ' + MAX_ATTEMPTS;
    b.onclick = () => startAttempt();
    box.appendChild(b);
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.style.gridColumn = '1 / -1';
    hint.textContent =
      left +
      ' try' +
      (left > 1 ? 's' : '') +
      ' left · One attempt = Level 1 until you lose, finish, or stop · Highest score counts';
    box.appendChild(hint);
  }

  $('btn-play').onclick = async () => {
    const name = $('inp-name').value.trim();
    const grade = $('inp-grade').value;
    const section = $('inp-section').value.trim();
    if (!name || name.length < 2) {
      alert('Enter your first and last name.');
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
  $('btn-retry').onclick = () => {
    // Starts the next attempt (only shown when previous attempt ended and tries remain)
    startAttempt();
  };
  $('btn-menu').onclick = () => {
    // If leaving while a level is mid-flight, that attempt still ends when they already hit summary.
    // If somehow still in game, treat as quit → end attempt.
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

  // Expose constants for tests
  window.__IR_TEST__ = {
    BASE_SPEED,
    GATE_SPAWN,
    GATE_APPROACH,
    GATE_HIT_Z,
    MAX_ATTEMPTS,
    levelSpeed,
    getProgress: () => progress,
    getAttempt: () => attempt,
    getRun: () => run,
  };

  $('inp-name').value = localStorage.getItem('ir-name') || '';
  $('inp-grade').value = localStorage.getItem('ir-grade') || '11';
  $('inp-section').value = localStorage.getItem('ir-section') || '';
  window.addEventListener('resize', () => {
    if (screens.game.classList.contains('active')) resize();
  });
  show('start');
})();
