#!/usr/bin/env python3
import asyncio, json, math
from pathlib import Path
from playwright.async_api import async_playwright

OUT = Path('/workspace')

async def play_level(page, tag, max_q=8):
    """Autopilot: read __IR_RUN__, steer to correct lane, wait for advance."""
    answered = 0
    scores = []
    for i in range(max_q):
        st = await page.evaluate('''() => {
          const r = window.__IR_RUN__;
          if (!r || r.over) return null;
          const q = r.questions[r.qIndex];
          if (!q) return null;
          const lane = q.options.indexOf(q.answer);
          return {
            qIndex: r.qIndex, prompt: q.prompt, answer: q.answer, options: q.options,
            lane, score: r.score, lives: r.lives, gateZ: r.gateZ, gateHit: r.gateHit
          };
        }''')
        if not st:
            break
        # Steer to correct lane
        await page.evaluate('''(lane) => {
          const r = window.__IR_RUN__;
          if (r) { r.targetLane = lane; r.carX = lane; }
        }''', st['lane'])
        # Fast-forward gate to hit plane
        await page.evaluate('''() => {
          const r = window.__IR_RUN__;
          if (r && !r.gateHit) r.gateZ = 0.11;
        }''')
        # Wait for flash then advance
        await page.wait_for_timeout(700)
        after = await page.evaluate('''() => {
          const r = window.__IR_RUN__;
          return r ? {qIndex:r.qIndex, score:r.score, lives:r.lives, correct:r.correct, over:r.over} : null;
        }''')
        scores.append({'before': st, 'after': after})
        answered += 1
        # screenshot mid-run once
        if i == 2:
            await page.screenshot(path=str(OUT / f'ir_{tag}_gameplay.png'))
        if after and after.get('over'):
            break
    return answered, scores

async def run_on(browser, url, tag):
    ctx = await browser.new_context(
        viewport={'width': 390, 'height': 844},
        device_scale_factor=2,
        is_mobile=True,
        has_touch=True,
    )
    page = await ctx.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    r = await page.goto(url, wait_until='networkidle', timeout=60000)
    status = r.status if r else None
    await page.screenshot(path=str(OUT / f'ir_{tag}_start.png'))
    await page.fill('#inp-name', 'Ana Test')
    await page.select_option('#inp-grade', '11')
    await page.fill('#inp-section', 'STEM')
    await page.click('#btn-play')
    await page.wait_for_selector('#level-btns button.lvl')
    await page.screenshot(path=str(OUT / f'ir_{tag}_levels.png'))
    await page.click('#level-btns button.lvl >> nth=0')
    await page.wait_for_selector('#screen-game.active')
    await page.wait_for_timeout(300)

    # Verify generator presence
    gen_ok = await page.evaluate('() => !!(window.IRQuestions && IRQuestions.generateLevel(1,5).length===5)')
    # Verify arithmetic sample
    sample = await page.evaluate('''() => {
      const items = IRQuestions.generateLevel(3, 30);
      let bad = 0;
      for (const q of items) {
        if (!q.options.includes(q.answer) || new Set(q.options).size !== 3) bad++;
      }
      return {n: items.length, bad, sample: items.slice(0,3)};
    }''')

    answered, scores = await play_level(page, tag, max_q=6)
    # Check score increased on correct
    gained = []
    for s in scores:
      if s['after'] and s['before']:
        gained.append(s['after']['score'] - s['before']['score'])

    # Wrong-hit check: never shows answer in DOM flash text
    # Force a wrong hit
    await page.evaluate('''() => {
      const r = window.__IR_RUN__;
      if (!r || r.over) return;
      const q = r.questions[r.qIndex];
      const wrong = q.options.findIndex(o => o !== q.answer);
      r.targetLane = wrong; r.carX = wrong; r.gateZ = 0.11; r.gateHit = false;
    }''')
    await page.wait_for_timeout(400)
    body_text = await page.inner_text('body')
    # flash is canvas, not DOM — check canvas doesn't write answer into HUD
    hud_prompt = await page.inner_text('#hud-prompt')
    # answer should not appear as a separate "Answer is" — HUD still shows question only
    leak = await page.evaluate('''() => {
      const r = window.__IR_RUN__;
      if (!r || !r.flash) return {flash:null};
      // flash text is drawn on canvas only; ensure we didn't add DOM reveal
      return {
        flashKind: r.flash.kind,
        hasAnswerDom: !!document.body.innerText.match(/answer\\s*(is|=)/i)
      };
    }''')

    # Leaderboard submit/read
    # Finish remaining quickly or go to summary via ending
    # Jump to end of level for submit test
    await page.evaluate('''() => {
      const r = window.__IR_RUN__;
      if (!r) return;
      r.correct = 15; r.qIndex = 19; r.score = Math.max(r.score, 150); r.lives = 3;
      // trigger end via advance
      r.gateHit = true; r.flash = {kind:'ok', t:0.01, gained:10};
    }''')
    await page.wait_for_timeout(800)
    # If still in game, force endLevel by depleting via evaluate of advance enough times
    screen = await page.evaluate('''() => ({
      summary: document.getElementById('screen-summary').classList.contains('active'),
      game: document.getElementById('screen-game').classList.contains('active'),
      sum: document.getElementById('sum-detail') && document.getElementById('sum-detail').textContent,
      sync: document.getElementById('sum-sync') && document.getElementById('sum-sync').textContent
    })''')
    if not screen['summary']:
        # force show by clicking through — call end by setting over path
        await page.evaluate('''() => {
          const r = window.__IR_RUN__;
          if (!r) return;
          r.qIndex = 20; r.correct = 15; r.gateHit = true; r.flash = null;
        }''')
        # Manually invoke by navigating gates
        for _ in range(5):
            await page.evaluate('''() => {
              const r = window.__IR_RUN__;
              if (!r || r.over) return;
              const q = r.questions[r.qIndex];
              if (!q) { r.qIndex = 20; return; }
              const lane = q.options.indexOf(q.answer);
              r.targetLane = lane; r.carX = lane; r.gateZ = 0.11; r.gateHit = false;
            }''')
            await page.wait_for_timeout(650)
            done = await page.evaluate('() => window.__IR_RUN__ && window.__IR_RUN__.over')
            if done: break
        await page.wait_for_timeout(500)
        screen = await page.evaluate('''() => ({
          summary: document.getElementById('screen-summary').classList.contains('active'),
          sum: document.getElementById('sum-detail') && document.getElementById('sum-detail').textContent,
          sync: document.getElementById('sum-sync') && document.getElementById('sum-sync').textContent
        })''')

    await page.screenshot(path=str(OUT / f'ir_{tag}_summary.png'))

    # Open leaderboard
    if screen.get('summary'):
        await page.click('#btn-menu')
    await page.click('#btn-go-board')
    await page.wait_for_timeout(1500)
    board_rows = await page.evaluate('() => document.getElementById("board-body").innerText')
    await page.screenshot(path=str(OUT / f'ir_{tag}_board.png'))

    # Speed check: level 5 base > level 1
    speed_ok = await page.evaluate('''() => {
      // BASE_SPEED not exported; infer from playing L1 vs checking constants in source — skip
      return true;
    }''')

    await ctx.close()
    return {
        'tag': tag, 'status': status, 'gen_ok': gen_ok, 'sample': sample,
        'answered': answered, 'gains': gained, 'leak': leak, 'screen': screen,
        'board_snippet': (board_rows or '')[:300], 'errors': errors,
        'shots': [f'/workspace/ir_{tag}_{n}.png' for n in ['start','levels','gameplay','summary','board']]
    }

async def main():
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True, args=['--no-sandbox'])
        local = await run_on(browser, 'http://127.0.0.1:8765/', 'local')
        print('LOCAL', json.dumps({k:v for k,v in local.items() if k!='sample'}, indent=2, default=str)[:2500])
        print('sample', local['sample'])
        await browser.close()

asyncio.run(main())
