/* Integer Racer — canvas runner. Mobile-first, low-data. */
(function () {
  'use strict';

  const API_NS = 'bnhs-iracer-nov2026';
  const API = 'https://mantledb.sh/v2/' + API_NS;
  const API_LIST = 'https://mantledb.sh/v2/list/' + API_NS;
  const API_EXPORT = 'https://mantledb.sh/v2/export/' + API_NS;
  // Optional Apps Script override (paste /exec URL to use Sheet instead of MantleDB)
  const GAS_URL = '';

  const LEVELS = 5;
  const ITEMS = 20;
  const LIVES = 3;
  const UNLOCK_MIN = 12; // need 12/20 to unlock next
  const BASE_PTS = [0, 10, 20, 30, 40, 50];
  const BASE_SPEED = [0, 2.2, 2.7, 3.2, 3.8, 4.4]; // lane units / sec-ish
  const MAX_PLAUSIBLE = 4000; // anti-cheat filter

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

  // ---- Player state ----
  let player = { name: '', grade: '11', section: '' };
  let progress = { unlocked: 1, totals: 0, bestLevel: 0, levelBest: {} };
  let run = null; // active run state
  let raf = 0;

  function loadProgress() {
    try {
      const raw = localStorage.getItem('ir-progress-' + keyOf(player));
      if (raw) progress = Object.assign(progress, JSON.parse(raw));
    } catch (e) {}
  }
  function saveProgress() {
    try {
      localStorage.setItem('ir-progress-' + keyOf(player), JSON.stringify(progress));
    } catch (e) {}
  }
  function keyOf(p) {
    return norm(p.name) + '-g' + p.grade;
  }
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 48) || 'anon';
  }

  // ---- Leaderboard ----
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
        if (path.indexOf('scores/') === 0 && bag[path] && bag[path].name) {
          entries.push(bag[path]);
        }
      });
      return entries.filter((e) => Number(e.total) <= MAX_PLAUSIBLE);
    } catch (e) {
      // local fallback
      try {
        return JSON.parse(localStorage.getItem('ir-local-board') || '[]');
      } catch (e2) {
        return [];
      }
    }
  }

  async function submitScore(entry) {
    // Keep best total for name+grade
    const local = JSON.parse(localStorage.getItem('ir-local-board') || '[]');
    const idx = local.findIndex((e) => norm(e.name) === norm(entry.name) && String(e.grade) === String(entry.grade));
    if (idx >= 0) {
      if (entry.total > local[idx].total) local[idx] = entry;
      else entry = local[idx]; // still POST current best we know
    } else local.push(entry);
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
      // Read existing remote best for this key, keep max
      const path = API + '/scores/' + keyOf(entry);
      let best = entry;
      try {
        const prev = await (await fetch(path + '?t=' + Date.now())).json();
        if (prev && prev.name && Number(prev.total) > Number(entry.total)) best = prev;
        else if (prev && prev.name) {
          best = {
            ...entry,
            total: Math.max(Number(prev.total) || 0, Number(entry.total) || 0),
            bestLevel: Math.max(Number(prev.bestLevel) || 0, Number(entry.bestLevel) || 0),
            correct: Math.max(Number(prev.correct) || 0, Number(entry.correct) || 0),
          };
        }
      } catch (e) {}
      if (Number(best.total) > MAX_PLAUSIBLE) return false;
      await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(best),
      });
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

  // ---- Canvas game ----
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

  function startLevel(level) {
    if (level > progress.unlocked) {
      alert('Finish the previous level with at least ' + UNLOCK_MIN + '/' + ITEMS + ' correct to unlock.');
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
      lane: 1, // 0,1,2
      targetLane: 1,
      carX: 1,
      speed: BASE_SPEED[level],
      dist: 0,
      gateZ: 1.15, // depth 0 near, 1 far — gates spawn far
      gateHit: false,
      flash: null, // {kind,t}
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
    $('hud-level').textContent = 'L' + run.level;
    $('hud-q').textContent = run.qIndex + 1 + '/' + ITEMS;
    $('hud-score').textContent = String(run.score);
    $('hud-lives').textContent = '❤'.repeat(run.lives) + '♡'.repeat(Math.max(0, LIVES - run.lives));
    const q = run.questions[run.qIndex];
    $('hud-prompt').textContent = q ? q.prompt : '';
  }

  function currentGate() {
    const q = run.questions[run.qIndex];
    if (!q) return null;
    // Map 3 options to 3 lanes; shuffle once per question stored on q._lanes
    if (!q._lanes) {
      q._lanes = [0, 1, 2];
      // already random options order; lane i shows options[i]
    }
    return q;
  }

  function hitGate(lane) {
    if (run.gateHit || run.over) return;
    run.gateHit = true;
    const q = currentGate();
    const chosen = q.options[lane];
    const ok = chosen === q.answer;
    // NEVER reveal correct answer
    if (ok) {
      run.correct++;
      run.streak++;
      const base = BASE_PTS[run.level];
      const bonus = Math.floor(run.streak / 3) * 5;
      const gained = base + bonus;
      run.score += gained;
      run.flash = { kind: 'ok', t: 0.55, gained: gained };
    } else {
      run.streak = 0;
      run.lives--;
      run.flash = { kind: 'bad', t: 0.55 };
      if (run.lives <= 0) {
        endLevel(false);
        return;
      }
    }
    // advance after short delay via flash timeout handled in loop
  }

  function advanceQuestion() {
    run.qIndex++;
    run.gateHit = false;
    run.gateZ = 1.15;
    run.speed = BASE_SPEED[run.level] + Math.min(1.6, run.qIndex * 0.04);
    if (run.qIndex >= ITEMS) {
      endLevel(true);
      return;
    }
    updateHud();
  }

  function endLevel(finished) {
    run.over = true;
    cancelAnimationFrame(raf);
    const passed = run.correct >= UNLOCK_MIN;
    progress.totals = (progress.totals || 0) + run.score;
    progress.bestLevel = Math.max(progress.bestLevel || 0, finished || run.correct > 0 ? run.level : progress.bestLevel || 0);
    if (finished && passed && run.level >= progress.unlocked && run.level < LEVELS) {
      progress.unlocked = run.level + 1;
    }
    if (finished && passed && run.level === LEVELS) {
      progress.unlocked = LEVELS; // all done
      progress.bestLevel = LEVELS;
    }
    const prevBest = progress.levelBest[run.level] || 0;
    if (run.score > prevBest) progress.levelBest[run.level] = run.score;
    saveProgress();

    $('sum-title').textContent = finished ? (passed ? 'Level ' + run.level + ' Clear!' : 'Level ' + run.level + ' Done') : 'Out of lives';
    $('sum-detail').textContent =
      'Correct: ' + run.correct + '/' + ITEMS +
      ' · Level points: ' + run.score +
      ' · Total: ' + progress.totals +
      (finished && !passed ? ' · Need ' + UNLOCK_MIN + '/' + ITEMS + ' to unlock next' : '') +
      (finished && passed && run.level < LEVELS ? ' · Level ' + (run.level + 1) + ' unlocked!' : '') +
      (finished && passed && run.level === LEVELS ? ' · All 5 levels cleared!' : '');

    $('btn-next').style.display = finished && passed && run.level < LEVELS ? '' : 'none';
    $('btn-retry').style.display = !finished || !passed ? '' : 'none';
    $('btn-menu').style.display = '';

    // Submit running total (best kept server-side)
    progress.totalCorrect = (progress.totalCorrect || 0) + run.correct;
    const entry = {
      name: player.name,
      grade: player.grade,
      section: player.section || '',
      total: progress.totals,
      bestLevel: progress.bestLevel,
      correct: progress.totalCorrect,
      unlocked: progress.unlocked,
      ts: Date.now(),
    };
    $('sum-sync').textContent = 'Saving score…';
    submitScore(entry).then((ok) => {
      $('sum-sync').textContent = ok ? 'Score saved to leaderboard.' : 'Saved on this phone (offline). Will sync when online.';
    });

    show('summary');
    paintLevelButtons();
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

    // steer toward target lane
    run.carX += (run.targetLane - run.carX) * Math.min(1, dt * 12);
    run.lane = Math.round(run.carX);

    // move road / gate
    run.roadOffset = (run.roadOffset + run.speed * dt * 1.8) % 1;
    if (!run.gateHit) {
      run.gateZ -= run.speed * dt * 0.22;
      if (run.gateZ <= 0.12) {
        // crossing plane
        hitGate(Math.round(run.carX));
      }
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
    // z: 1 far -> 0 near
    const horizon = H * 0.28;
    const nearY = H * 0.92;
    const y = horizon + (nearY - horizon) * (1 - z);
    const roadNearW = W * 0.92;
    const roadFarW = W * 0.18;
    const roadW = roadFarW + (roadNearW - roadFarW) * (1 - z);
    const cx = W / 2;
    const laneWidth = roadW / 3;
    const x = cx - roadW / 2 + laneWidth * (lane + 0.5);
    return { x, y, s: 0.25 + 0.75 * (1 - z), roadW, laneWidth };
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // sky
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#87c6ef');
    g.addColorStop(0.35, '#c9e7a5');
    g.addColorStop(1, '#5a8f3c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // road trapezoid
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

    // lane lines
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

    // dashed center motion
    ctx.strokeStyle = '#f5c518';
    ctx.setLineDash([12, 14]);
    ctx.beginPath();
    const midZ0 = (run.roadOffset % 1);
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

    // gates
    const q = currentGate();
    if (q && run.gateZ > 0) {
      for (let lane = 0; lane < 3; lane++) {
        const p = project(lane, Math.max(0, run.gateZ));
        const bw = p.laneWidth * 0.82;
        const bh = 36 * p.s + 18;
        ctx.fillStyle = run.gateHit
          ? (run.flash && run.flash.kind === 'ok' && Math.round(run.carX) === lane
              ? '#2e7d32'
              : run.flash && run.flash.kind === 'bad' && Math.round(run.carX) === lane
                ? '#c62828'
                : 'rgba(255,255,255,0.35)')
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

    // car
    const cp = project(run.carX, 0.02);
    drawCar(cp.x, cp.y - 10, 1);

    // flash banner — no answer reveal
    if (run.flash) {
      ctx.fillStyle = run.flash.kind === 'ok' ? 'rgba(46,125,50,0.85)' : 'rgba(198,40,40,0.85)';
      ctx.fillRect(0, H * 0.38, W, 48);
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 22px system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(run.flash.kind === 'ok' ? 'CORRECT! +' + (run.flash.gained || BASE_PTS[run.level]) : 'MISS! Keep going', W / 2, H * 0.38 + 28);
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
    // body
    ctx.fillStyle = '#e53935';
    roundRect(x - w / 2, y - h, w, h, 10);
    ctx.fill();
    // cabin
    ctx.fillStyle = '#bbdefb';
    roundRect(x - w * 0.32, y - h * 0.78, w * 0.64, h * 0.28, 6);
    ctx.fill();
    // headlights
    ctx.fillStyle = '#fff59d';
    ctx.fillRect(x - w * 0.38, y - h * 0.12, w * 0.2, h * 0.08);
    ctx.fillRect(x + w * 0.18, y - h * 0.12, w * 0.2, h * 0.08);
    // wheels
    ctx.fillStyle = '#111';
    ctx.fillRect(x - w * 0.55, y - h * 0.35, w * 0.12, h * 0.22);
    ctx.fillRect(x + w * 0.43, y - h * 0.35, w * 0.12, h * 0.22);
    ctx.fillRect(x - w * 0.55, y - h * 0.85, w * 0.12, h * 0.22);
    ctx.fillRect(x + w * 0.43, y - h * 0.85, w * 0.12, h * 0.22);
  }

  // ---- Controls ----
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
      else {
        // tap half
        const mid = rect.left + rect.width / 2;
        steer(x < mid ? -1 : 1);
      }
      touchX0 = null;
      e.preventDefault();
    },
    { passive: false }
  );

  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') steer(-1);
    if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') steer(1);
  });

  // on-screen buttons
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
    const g = e.gamma; // -90..90
    if (g == null) return;
    if (g < -12) run.targetLane = 0;
    else if (g > 12) run.targetLane = 2;
    else run.targetLane = 1;
  });

  // ---- UI wiring ----
  function paintLevelButtons() {
    const box = $('level-btns');
    box.innerHTML = '';
    for (let L = 1; L <= LEVELS; L++) {
      const b = document.createElement('button');
      b.className = 'lvl' + (L <= progress.unlocked ? '' : ' locked');
      b.textContent = L <= progress.unlocked ? 'Level ' + L : 'Level ' + L + ' 🔒';
      b.disabled = L > progress.unlocked;
      b.onclick = () => startLevel(L);
      box.appendChild(b);
    }
  }

  $('btn-play').onclick = () => {
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
    progress = { unlocked: 1, totals: 0, bestLevel: 0, levelBest: {} };
    loadProgress();
    paintLevelButtons();
    $('player-label').textContent = name + ' · G' + grade + (section ? ' · ' + section : '');
    // stay on start but show levels — or jump into L1
    $('levels-wrap').style.display = '';
  };

  $('btn-go-board').onclick = async () => {
    show('board');
    $('board-body').innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
    const entries = await fetchBoard();
    renderBoard(entries, $('board-filter').value);
  };
  $('board-filter').onchange = async () => {
    const entries = await fetchBoard();
    renderBoard(entries, $('board-filter').value);
  };
  $('btn-board-back').onclick = () => show('start');

  $('btn-next').onclick = () => {
    if (run) startLevel(run.level + 1);
  };
  $('btn-retry').onclick = () => {
    if (run) startLevel(run.level);
  };
  $('btn-menu').onclick = () => {
    show('start');
    paintLevelButtons();
    $('levels-wrap').style.display = '';
  };

  // init
  $('inp-name').value = localStorage.getItem('ir-name') || '';
  $('inp-grade').value = localStorage.getItem('ir-grade') || '11';
  $('inp-section').value = localStorage.getItem('ir-section') || '';
  window.addEventListener('resize', () => {
    if (screens.game.classList.contains('active')) resize();
  });
  show('start');
})();
