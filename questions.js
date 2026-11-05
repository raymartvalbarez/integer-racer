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
  function fmt(n) {
    // Unicode minus inside parentheses so '5 − (−3)' reads clearly (not ASCII hyphen)
    if (n < 0) return '(−' + Math.abs(n) + ')';
    return String(n);
  }
  function uniqOpts(correct, distractors) {
    const set = new Set([correct]);
    for (const d of distractors) {
      if (d !== correct && Number.isFinite(d) && !set.has(d)) set.add(d);
      if (set.size >= 3) break;
    }
    let k = 1;
    while (set.size < 3) {
      if (!set.has(correct + k)) set.add(correct + k);
      if (set.size < 3 && !set.has(correct - k)) set.add(correct - k);
      k++;
      if (k > 80) break;
    }
    const opts = shuffle([...set].slice(0, 3));
    if (!opts.includes(correct)) opts[0] = correct;
    return shuffle(opts);
  }

  function make(prompt, answer, distractors) {
    return { prompt, answer, options: uniqOpts(answer, distractors) };
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
      distractors = [a - b, Math.abs(a) + Math.abs(b), -(a + b), a + Math.abs(b)];
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
      ans = a + b;
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
      ans = a - (-b);
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
      ans = a - b;
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

  // Level 4: MIXED operations — add, sub, mul, div, order of ops
  function genL4() {
    const kind = pick(['add', 'sub', 'mul', 'div', 'oop', 'oop2', 'mix', 'paren']);
    let a, b, c, ans, prompt, distractors;
    if (kind === 'add') {
      a = rnd(-18, 18); b = rnd(-18, 18);
      if (!a) a = -6; if (!b) b = 9;
      ans = a + b;
      prompt = a + ' + ' + fmt(b) + ' = ?';
      distractors = [a - b, Math.abs(a) + Math.abs(b), -(a + b)];
    } else if (kind === 'sub') {
      a = rnd(-18, 18); b = rnd(-15, 15);
      if (!a) a = 7; if (!b) b = -4;
      ans = a - b;
      prompt = a + ' − ' + fmt(b) + ' = ?';
      distractors = [a + b, b - a, -(a - b), a - Math.abs(b)];
    } else if (kind === 'mul') {
      a = pick([-1, 1]) * rnd(2, 12);
      b = pick([-1, 1]) * rnd(2, 12);
      ans = a * b;
      prompt = fmt(a) + ' × ' + fmt(b) + ' = ?';
      distractors = [-ans, a + b, Math.abs(a * b) * (ans > 0 ? -1 : 1)];
    } else if (kind === 'div') {
      b = pick([-1, 1]) * rnd(2, 12);
      const q = pick([-1, 1]) * rnd(1, 12);
      a = b * q;
      ans = q;
      prompt = a + ' ÷ ' + fmt(b) + ' = ?';
      distractors = [-ans, a - b, Math.abs(ans) * (ans > 0 ? -1 : 1)];
    } else if (kind === 'oop') {
      a = rnd(-9, 9); if (!a) a = -3;
      b = rnd(2, 8); c = rnd(2, 8);
      ans = a + b * c;
      prompt = a + ' + ' + b + ' × ' + c + ' = ?';
      distractors = [(a + b) * c, a - b * c, a + b + c];
    } else if (kind === 'oop2') {
      a = rnd(-8, 8); if (!a) a = 4;
      b = rnd(2, 6); c = rnd(2, 5);
      ans = a - b * c;
      prompt = a + ' − ' + b + ' × ' + c + ' = ?';
      distractors = [(a - b) * c, a + b * c, a - b - c];
    } else if (kind === 'paren') {
      a = rnd(-8, 8); if (!a) a = -5;
      b = rnd(-6, 6); if (!b) b = 3;
      c = rnd(2, 6);
      ans = (a + b) * c;
      prompt = '(' + a + ' + ' + fmt(b) + ') × ' + c + ' = ?';
      distractors = [a + b * c, a + b + c, -(a + b) * c];
    } else {
      a = rnd(-12, 12); if (!a) a = -5;
      b = rnd(2, 9);
      ans = a * b - b;
      prompt = fmt(a) + ' × ' + b + ' − ' + b + ' = ?';
      distractors = [a * b + b, a * (b - 1) + 1, -(a * b - b)];
    }
    return make(prompt, ans, distractors);
  }

  // Level 5: DOUBLE-DIGIT integers (±10..99 range), all four ops + mix
  function genL5() {
    const kind = pick(['add', 'sub', 'mul', 'div', 'mix', 'oop', 'mul2']);
    let a, b, c, ans, prompt, distractors;
    function dd() {
      // double-digit magnitude 10–48 (keeps products manageable)
      return pick([-1, 1]) * rnd(10, 48);
    }
    if (kind === 'add') {
      a = dd(); b = dd();
      ans = a + b;
      prompt = a + ' + ' + fmt(b) + ' = ?';
      distractors = [a - b, Math.abs(a) + Math.abs(b), -(a + b), a + Math.abs(b)];
    } else if (kind === 'sub') {
      a = dd(); b = dd();
      ans = a - b;
      prompt = a + ' − ' + fmt(b) + ' = ?';
      distractors = [a + b, b - a, -(a - b), a - Math.abs(b)];
    } else if (kind === 'mul' || kind === 'mul2') {
      // e.g. (-12)(-6), 15×(-4)
      a = pick([-1, 1]) * rnd(10, 18);
      b = pick([-1, 1]) * rnd(3, 12);
      ans = a * b;
      prompt = fmt(a) + ' × ' + fmt(b) + ' = ?';
      distractors = [-ans, a + b, Math.abs(a) * Math.abs(b) * (ans > 0 ? -1 : 1), a - b];
    } else if (kind === 'div') {
      // e.g. -84 ÷ 7 — exact division, dividend often double-digit
      b = pick([-1, 1]) * rnd(3, 12);
      const q = pick([-1, 1]) * rnd(10, 18);
      a = b * q;
      ans = q;
      prompt = a + ' ÷ ' + fmt(b) + ' = ?';
      distractors = [-ans, a - b, Math.abs(ans) * (ans > 0 ? -1 : 1), q + pick([-2, -1, 1, 2])];
    } else if (kind === 'oop') {
      a = dd();
      b = rnd(2, 9); c = rnd(2, 8);
      ans = a + b * c;
      prompt = a + ' + ' + b + ' × ' + c + ' = ?';
      distractors = [(a + b) * c, a - b * c, a + b + c];
    } else {
      // mix: -48 + 27 style or product-sum
      if (Math.random() < 0.5) {
        a = dd(); b = dd();
        ans = a + b;
        prompt = a + ' + ' + fmt(b) + ' = ?';
        distractors = [a - b, Math.abs(a) + Math.abs(b), -(a + b)];
      } else {
        a = pick([-1, 1]) * rnd(10, 16);
        b = pick([-1, 1]) * rnd(3, 9);
        c = rnd(2, 12);
        ans = a * b + c;
        prompt = fmt(a) + ' × ' + fmt(b) + ' + ' + c + ' = ?';
        distractors = [a * (b + c), a * b - c, -(a * b) + c];
      }
    }
    return make(prompt, ans, distractors);
  }


  // Independent re-evaluation of the displayed prompt (order of ops, unary minus, parens).
  // Used as a hard gate so a generator bug cannot ship a wrong "answer" field.
  function evalPrompt(prompt) {
    const s = String(prompt)
      .replace(/\s*=\s*\?\s*$/, '')
      .replace(/×/g, '*')
      .replace(/÷/g, '/')
      .replace(/[−–—]/g, '-')
      .trim();
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (c === ' ') { i++; continue; }
      if (c === '(' || c === ')' || c === '+' || c === '*' || c === '/') {
        tokens.push(c); i++; continue;
      }
      if (c === '-') {
        const prev = tokens[tokens.length - 1];
        if (prev !== undefined && (typeof prev === 'number' || prev === ')')) {
          tokens.push('-'); i++; continue;
        }
        i++;
        let j = i;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
        if (j === i) throw new Error('bad unary');
        tokens.push(-Number(s.slice(i, j)));
        i = j;
        continue;
      }
      if (/[0-9]/.test(c)) {
        let j = i;
        while (j < s.length && /[0-9]/.test(s[j])) j++;
        tokens.push(Number(s.slice(i, j)));
        i = j;
        continue;
      }
      throw new Error('bad char ' + c);
    }
    const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
    const out = [], ops = [];
    for (const tok of tokens) {
      if (typeof tok === 'number') out.push(tok);
      else if (tok === '(') ops.push(tok);
      else if (tok === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') out.push(ops.pop());
        ops.pop();
      } else {
        while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[tok]) {
          out.push(ops.pop());
        }
        ops.push(tok);
      }
    }
    while (ops.length) out.push(ops.pop());
    const st = [];
    for (const tok of out) {
      if (typeof tok === 'number') { st.push(tok); continue; }
      const b = st.pop(), a = st.pop();
      if (tok === '+') st.push(a + b);
      else if (tok === '-') st.push(a - b);
      else if (tok === '*') st.push(a * b);
      else if (tok === '/') st.push(a / b);
    }
    if (st.length !== 1 || !Number.isFinite(st[0])) throw new Error('eval');
    const v = st[0];
    if (Math.abs(v - Math.round(v)) > 1e-9) throw new Error('non-int');
    return Math.round(v);
  }

  const GENERATORS = [null, genL1, genL2, genL3, genL4, genL5];

  function generateLevel(level, count) {
    const gen = GENERATORS[level] || genL1;
    const items = [];
    const seen = new Set();
    let guard = 0;
    while (items.length < count && guard < count * 80) {
      guard++;
      const q = gen();
      if (!Number.isFinite(q.answer)) continue;
      let trueAns;
      try { trueAns = evalPrompt(q.prompt); } catch (e) { continue; }
      // Force the stored answer to match the displayed expression
      q.answer = trueAns;
      // Rebuild options so exactly one equals the true answer
      q.options = uniqOpts(trueAns, (q.options || []).filter((o) => o !== trueAns));
      if (!q.options.includes(q.answer)) continue;
      if (q.options.length !== 3) continue;
      if (new Set(q.options).size !== 3) continue;
      if (q.options.filter((o) => o === q.answer).length !== 1) continue;
      const key = q.prompt + '|' + q.answer;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(q);
    }
    return items;
  }

  function verifySample(nPerLevel) {
    const report = [];
    for (let L = 1; L <= 5; L++) {
      const items = generateLevel(L, nPerLevel);
      let bad = 0;
      let dd = 0;
      for (const q of items) {
        if (!q.options.includes(q.answer) || q.options.length !== 3) bad++;
        if (L === 5 && /(?:^|[^\d])-?\d{2,}/.test(q.prompt)) dd++;
      }
      report.push({ level: L, count: items.length, bad, doubleDigitish: dd });
    }
    return report;
  }

  global.IRQuestions = { generateLevel, verifySample, generators: GENERATORS, evalPrompt, uniqOpts, fmt };
})(typeof window !== 'undefined' ? window : global);
