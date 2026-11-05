/* Integer Racer question generators — Levels 1–5. Never exposes answer in UI after a miss. */
(function (global) {
  'use strict';

  function rnd(a, b) { return a + Math.floor(Math.random() * (b - a + 1)); }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function fmt(n) { return n < 0 ? '(' + n + ')' : String(n); }
  function uniqOpts(correct, distractors) {
    const set = new Set([correct]);
    for (const d of distractors) {
      if (d !== correct && Number.isFinite(d) && !set.has(d)) set.add(d);
      if (set.size >= 3) break;
    }
    // pad with nearby ints if needed
    let k = 1;
    while (set.size < 3) {
      if (!set.has(correct + k)) set.add(correct + k);
      if (set.size < 3 && !set.has(correct - k)) set.add(correct - k);
      k++;
      if (k > 40) break;
    }
    const opts = shuffle([...set].slice(0, 3));
    // ensure correct is among the three
    if (!opts.includes(correct)) opts[0] = correct;
    return shuffle(opts);
  }

  function make(prompt, answer, distractors) {
    const options = uniqOpts(answer, distractors);
    return { prompt, answer, options };
  }

  // Level 1: add/sub small integers
  function genL1() {
    const kind = pick(['add', 'sub', 'addneg', 'subpos']);
    let a, b, ans, prompt, distractors;
    if (kind === 'add') {
      a = rnd(-12, 12); b = rnd(-12, 12);
      if (a === 0) a = pick([-3, -5, 4, 7]);
      if (b === 0) b = pick([-2, -6, 3, 8]);
      ans = a + b;
      prompt = a + ' + ' + fmt(b) + ' = ?';
      distractors = [a - b, Math.abs(a) + Math.abs(b), -(a + b), a + Math.abs(b), Math.abs(a) - Math.abs(b)];
    } else if (kind === 'sub') {
      a = rnd(-12, 12); b = rnd(1, 12);
      if (a === 0) a = pick([-4, 5, -8]);
      ans = a - b;
      prompt = a + ' − ' + b + ' = ?';
      distractors = [a + b, b - a, -(a - b), a - (-b)];
    } else if (kind === 'addneg') {
      a = rnd(1, 15); b = -rnd(1, 15);
      ans = a + b;
      prompt = a + ' + ' + fmt(b) + ' = ?';
      distractors = [a - b, a + Math.abs(b), -(a + b), Math.abs(a + b)];
    } else {
      a = rnd(-15, -1); b = rnd(1, 12);
      ans = a + b; // aka a - (-wait) — this is negative + positive
      prompt = a + ' + ' + b + ' = ?';
      distractors = [a - b, -(a + b), Math.abs(a) + b, a - (-b)];
    }
    return make(prompt, ans, distractors);
  }

  // Level 2: mixed add/sub, subtracting negatives
  function genL2() {
    const kind = pick(['subneg', 'negsub', 'addmix', 'doubleneg']);
    let a, b, ans, prompt, distractors;
    if (kind === 'subneg') {
      a = rnd(-15, 15); if (a === 0) a = 5;
      b = rnd(1, 12);
      ans = a - (-b); // a + b
      prompt = a + ' − ' + fmt(-b) + ' = ?';
      distractors = [a - b, -(a + b), b - a, a + (-b)];
    } else if (kind === 'negsub') {
      a = -rnd(1, 15); b = rnd(1, 12);
      ans = a - b;
      prompt = a + ' − ' + b + ' = ?';
      distractors = [a + b, -(a - b), Math.abs(a) - b, b - Math.abs(a)];
    } else if (kind === 'addmix') {
      a = rnd(-20, 20); b = rnd(-20, 20);
      if (a === 0) a = -7; if (b === 0) b = 9;
      ans = a + b;
      prompt = a + ' + ' + fmt(b) + ' = ?';
      distractors = [a - b, Math.abs(a) + Math.abs(b), -(a + b)];
    } else {
      a = -rnd(1, 12); b = -rnd(1, 12);
      ans = a - b; // -x - (-y) = -x + y
      prompt = a + ' − ' + fmt(b) + ' = ?';
      distractors = [a + b, -(a - b), Math.abs(a) - Math.abs(b), a - Math.abs(b)];
    }
    return make(prompt, ans, distractors);
  }

  // Level 3: multiply / divide with signs
  function genL3() {
    const kind = pick(['mul', 'mul2', 'div', 'div2']);
    let a, b, ans, prompt, distractors;
    if (kind === 'mul' || kind === 'mul2') {
      a = pick([-1, 1]) * rnd(2, 12);
      b = pick([-1, 1]) * rnd(2, 12);
      // bias toward mixed signs
      if (Math.random() < 0.55) b = -Math.abs(b) * (a > 0 ? 1 : pick([-1, 1]));
      ans = a * b;
      prompt = fmt(a) + ' × ' + fmt(b) + ' = ?';
      distractors = [-ans, a + b, Math.abs(a) * Math.abs(b) * (ans > 0 ? -1 : 1), a - b];
    } else {
      b = pick([-1, 1]) * rnd(2, 12);
      const q = pick([-1, 1]) * rnd(1, 12);
      a = b * q;
      ans = a / b;
      prompt = a + ' ÷ ' + fmt(b) + ' = ?';
      distractors = [-ans, a - b, Math.abs(ans) * (ans > 0 ? -1 : 1), q + 1];
    }
    return make(prompt, ans, distractors);
  }

  // Level 4: absolute value, order of operations, mixed
  function genL4() {
    const kind = pick(['abs', 'abs2', 'oop', 'oop2', 'mix']);
    let ans, prompt, distractors;
    if (kind === 'abs') {
      const a = -rnd(1, 25);
      ans = Math.abs(a);
      prompt = '|' + a + '| = ?';
      distractors = [a, -ans - 1, ans + 2];
    } else if (kind === 'abs2') {
      const a = rnd(-20, -1); const b = rnd(1, 15);
      ans = Math.abs(a) + b;
      prompt = '|' + a + '| + ' + b + ' = ?';
      distractors = [a + b, Math.abs(a + b), Math.abs(a) - b, -(Math.abs(a) + b)];
    } else if (kind === 'oop') {
      let a = rnd(-9, 9); if (a === 0) a = -3;
      const b = rnd(2, 6); const c = rnd(2, 8);
      ans = a + b * c;
      prompt = a + ' + ' + b + ' × ' + c + ' = ?';
      distractors = [(a + b) * c, a - b * c, a + b + c, Math.abs(a) + b * c];
    } else if (kind === 'oop2') {
      let a = rnd(-8, 8); if (a === 0) a = 4;
      let b = rnd(-6, 6); if (b === 0) b = -2;
      const c = rnd(2, 5);
      ans = (a + b) * c;
      prompt = '(' + a + ' + ' + fmt(b) + ') × ' + c + ' = ?';
      distractors = [a + b * c, a + b + c, -(a + b) * c, (a - b) * c];
    } else {
      let a = rnd(-12, 12); if (a === 0) a = -5;
      const b = rnd(2, 9);
      ans = a * b - b; // b(a-1)
      prompt = fmt(a) + ' × ' + b + ' − ' + b + ' = ?';
      distractors = [a * b + b, a * (b - 1) + 1, -(a * b - b), a - b];
    }
    return make(prompt, ans, distractors);
  }

  // Level 5: multi-step & contextual
  function genL5() {
    const kind = pick(['temp', 'elev', 'debt', 'steps', 'combo']);
    let ans, prompt, distractors;
    if (kind === 'temp') {
      const start = rnd(-8, 5);
      const drop = rnd(3, 12);
      ans = start - drop;
      prompt = 'Temp was ' + start + '°C, dropped ' + drop + '°. Now?';
      distractors = [start + drop, -start - drop, drop - start, Math.abs(start) - drop];
    } else if (kind === 'elev') {
      const start = rnd(-30, 40);
      const change = pick([-1, 1]) * rnd(5, 25);
      ans = start + change;
      const verb = change > 0 ? 'climbed' : 'descended';
      prompt = 'At ' + start + ' m, ' + verb + ' ' + Math.abs(change) + ' m. Now?';
      distractors = [start - change, -ans, Math.abs(start) + change, start + Math.abs(change)];
    } else if (kind === 'debt') {
      const owed = rnd(20, 80);
      const paid = rnd(5, owed - 1);
      ans = -(owed - paid);
      prompt = 'Owes ₱' + owed + ', pays ₱' + paid + '. Balance?';
      distractors = [owed - paid, -(owed + paid), paid - owed - 1, -owed];
    } else if (kind === 'steps') {
      let a = rnd(-9, 9); if (a === 0) a = -4;
      let b = rnd(-8, 8); if (b === 0) b = 3;
      let c = rnd(-6, 6); if (c === 0) c = -2;
      ans = a + b + c;
      prompt = a + ' + ' + fmt(b) + ' + ' + fmt(c) + ' = ?';
      distractors = [a + b - c, a - b + c, -(a + b + c), a + b];
    } else {
      const a = pick([-1, 1]) * rnd(2, 8);
      const b = pick([-1, 1]) * rnd(2, 8);
      const c = rnd(2, 5);
      ans = a * b + c;
      prompt = fmt(a) + ' × ' + fmt(b) + ' + ' + c + ' = ?';
      distractors = [a * (b + c), a * b - c, -(a * b) + c, a + b + c];
    }
    return make(prompt, ans, distractors);
  }

  const GENERATORS = [null, genL1, genL2, genL3, genL4, genL5];

  function generateLevel(level, count) {
    const gen = GENERATORS[level] || genL1;
    const items = [];
    const seen = new Set();
    let guard = 0;
    while (items.length < count && guard < count * 40) {
      guard++;
      const q = gen();
      if (!Number.isFinite(q.answer)) continue;
      if (!q.options.includes(q.answer)) continue;
      if (q.options.length !== 3) continue;
      if (new Set(q.options).size !== 3) continue;
      const key = q.prompt + '|' + q.answer;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(q);
    }
    return items;
  }

  // Self-check helpers for tests
  function verifySample(nPerLevel) {
    const report = [];
    for (let L = 1; L <= 5; L++) {
      const items = generateLevel(L, nPerLevel);
      let bad = 0;
      for (const q of items) {
        if (!q.options.includes(q.answer) || q.options.length !== 3) bad++;
      }
      report.push({ level: L, count: items.length, bad });
    }
    return report;
  }

  global.IRQuestions = { generateLevel, verifySample, generators: GENERATORS };
})(typeof window !== 'undefined' ? window : global);
