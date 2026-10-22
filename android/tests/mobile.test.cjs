const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const roots = {
  Windows: path.resolve(__dirname, '../../app/static'),
  Android: path.resolve(__dirname, '../app/src/main/assets/static'),
};
const fields = ['color', 'algebraic', 'white', 'black'];
const notation = ['algebraic', 'white', 'black'];
const labels = { color: 'Color', algebraic: 'Algebraic', white: 'White descriptive', black: 'Black descriptive' };
const colorButton = color => color === 'black' ? 'sdColorDark' : 'sdColorLight';
const suffix = key => key[0].toUpperCase() + key.slice(1);
const tick = () => new Promise(resolve => setImmediate(resolve));
const storage = () => ({ states: {}, settings: {}, calls: [] });

// An independent notation/color oracle: production conversion code is not used
// to manufacture the answers expected by these end-to-end DOM tests.
function expected(square) {
  const file = square.charCodeAt(0) - 97, rank = Number(square[1]);
  const name = ['QR', 'QN', 'QB', 'Q', 'K', 'KB', 'KN', 'KR'][file];
  return { color: (file + rank) % 2 ? 'black' : 'white', algebraic: square,
    white: name + rank, black: name + (9 - rank) };
}

function clock(w) {
  let now = 100000, nextId = 1;
  const jobs = new Map();
  w.Date.now = () => now;
  Object.defineProperty(w.performance, 'now', { value: () => now });
  const add = (callback, delay, repeat, args) => {
    const id = nextId++;
    jobs.set(id, { callback, at: now + Math.max(1, Number(delay) || 0), repeat, args });
    return id;
  };
  w.setTimeout = (fn, delay, ...args) => add(fn, delay, 0, args);
  w.setInterval = (fn, delay, ...args) => add(fn, delay, Math.max(1, Number(delay) || 0), args);
  w.clearTimeout = w.clearInterval = id => jobs.delete(id);
  return {
    advance(ms) {
      const end = now + ms;
      let guard = 0;
      while (true) {
        const due = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        assert.ok(++guard < 100000, 'timer does not spin indefinitely');
        const [id, job] = due; now = job.at;
        if (job.repeat) job.at += job.repeat; else jobs.delete(id);
        job.callback(...job.args);
      }
      now = end;
    },
  };
}

async function open(platform, store = storage(), options = {}) {
  const assets = roots[platform], errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error.message));
  vc.on('error', error => errors.push(String(error)));
  const dom = new JSDOM(fs.readFileSync(path.join(assets, 'index.html'), 'utf8'), {
    runScripts: 'outside-only', url: 'https://appassets.androidplatform.net/static/index.html',
    pretendToBeVisual: true, virtualConsole: vc,
  });
  const w = dom.window, d = w.document, timer = clock(w);
  let confirmed = true, hidden = false;
  w.confirm = () => confirmed; w.scrollTo = () => {};
  Object.defineProperty(d, 'hidden', { get: () => hidden, configurable: true });
  Object.defineProperty(d, 'visibilityState', { get: () => hidden ? 'hidden' : 'visible', configurable: true });
  // Fixed pseudo-random stream makes shuffles reproducible without forcing
  // Random prompts to a single format.
  let seed = 17519;
  w.Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  function request(url, method = 'GET', body = {}) {
    store.calls.push({ url, method });
    if (url === '/api/health') return { status: 'ok', version: '1.0.0' };
    if (url.startsWith('/api/state/')) {
      const id = url.slice('/api/state/'.length);
      if (method === 'GET') return { payload: structuredClone(store.states[id] || null) };
      if (method === 'PUT') { store.states[id] = structuredClone(body.payload); return { ok: true }; }
      if (method === 'DELETE') { delete store.states[id]; return { ok: true }; }
    }
    if (url === '/api/settings/theme') {
      if (method === 'PUT') store.settings.theme = body.theme;
      return { theme: store.settings.theme || 'light' };
    }
    throw new Error('Unexpected route: ' + url);
  }
  w.AndroidStore = { request(encoded) {
    const { url, method, body } = JSON.parse(encoded);
    return JSON.stringify({ ok: true, result: request(url, method, body) });
  } };
  w.fetch = async (url, options = {}) => {
    try {
      const result = request(url, options.method, options.body ? JSON.parse(options.body) : {});
      return { ok: true, status: 200, json: async () => result };
    } catch (error) { return { ok: false, status: 422, json: async () => ({ detail: error.message }) }; }
  };
  for (const script of d.querySelectorAll('script[src]')) {
    const sourcePath = path.join(assets, new URL(script.src).pathname.replace('/static/', ''));
    w.eval(fs.readFileSync(sourcePath, 'utf8'));
  }
  options.beforeReady?.({ w, d, store });
  if (options.waitForReady !== false) {
    for (let i = 0; i < 40 && d.body.dataset.ready !== 'true'; i++) await tick();
    assert.equal(d.body.dataset.ready, 'true', platform + ': drill initialized');
  }
  assert.deepEqual(errors, []);
  const app = {
    w, d, store, platform, errors,
    el: id => d.getElementById(id),
    state: () => store.states['square-drills'],
    close() { dom.window.close(); },
    confirm(value) { confirmed = value; },
    async settle(ms = 0) { timer.advance(ms); for (let i = 0; i < 4; i++) await tick(); assert.deepEqual(errors, []); },
    async advance(ms) { timer.advance(ms); for (let i = 0; i < 4; i++) await tick(); },
    async visibility(value) { hidden = value; d.dispatchEvent(new w.Event('visibilitychange')); await this.settle(); },
    change(id, value, event = 'change') {
      const el = d.getElementById(id); assert.ok(el, id + ' exists');
      el.value = value; el.dispatchEvent(new w.Event(event, { bubbles: true }));
    },
    check(id, value) { const el = d.getElementById(id); el.checked = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); },
    press(id) { const el = d.getElementById(id); assert.ok(el, id + ' exists'); el.click(); },
    enter(target = d) { target.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); },
    key(field, text) {
      const input = d.getElementById('sd' + suffix(field));
      assert.equal(input.disabled, false, field + ' is editable');
      input.focus(); input.click();
      const key = [...d.getElementById('sdKeypad').querySelectorAll('button')].find(button => button.textContent.trim() === text);
      assert.ok(key, `key ${text} exists for ${field}`); assert.equal(key.disabled, false); key.click();
    },
  };
  await app.settle(300);
  return app;
}

const modeCases = [
  { mode: 'all', selected: [...fields] },
  { mode: 'white', selected: ['color', 'white'] },
  { mode: 'algebraic', selected: ['color', 'algebraic'] },
  ...Array.from({ length: 8 }, (_, mask) => ({ mode: 'custom', mask,
    selected: ['color', ...notation.filter((_, i) => mask & (1 << i))] })),
];
function eligible(selected) { return selected.length === 2 ? notation.filter(key => key !== selected[1]) : notation; }
function chooseMode(a, c) {
  a.change('sdAnswerMode', c.mode);
  if (c.mode === 'custom') {
    for (const input of a.el('sdCustom').querySelectorAll('input[type=checkbox]')) {
      input.checked = c.selected.includes(input.value);
      input.dispatchEvent(new a.w.Event('change', { bubbles: true }));
    }
  }
}
function answer(a, values, required, color = values.color) {
  for (const field of required) {
    if (field === 'color') {
      if (color !== '' && a.el(colorButton(color)).getAttribute('aria-pressed') !== 'true') a.press(colorButton(color));
    } else {
      a.key(field, values[field].slice(0, -1)); a.key(field, values[field].slice(-1));
    }
  }
}
function requiredFor(a, c) { return c.selected.filter(field => field !== a.state().shownPrompt.format); }
function assertFreshFields(a, required) {
  for (const field of fields) {
    const input = a.el('sd' + suffix(field));
    assert.equal(input.value, '', field + ' answer is never autofilled');
    assert.equal(a.el('sdRow' + suffix(field)).hidden, !required.includes(field), field + ' visibility');
    if (!required.includes(field)) {
      assert.equal(input.disabled, true, field + ' hidden input is disabled');
      // JSDOM treats any tabindex as programmatically focusable even on disabled
      // inputs; assert the actual browser guards and keypad selection instead.
      assert.equal(input.tabIndex, -1, field + ' hidden input is outside keyboard navigation');
      assert.equal(a.el('sdRow' + suffix(field)).classList.contains('selected-field'), false);
    }
  }
  assert.equal(a.el('sdRowColor').hidden, false);
  assert.equal(a.el('sdColor').type, 'hidden');
  assert.equal(a.el('sdColor').tabIndex, -1, 'hidden color state is not keyboard focusable');
  for (const id of ['sdColorLight', 'sdColorDark']) {
    assert.equal(a.el(id).getAttribute('aria-pressed'), 'false', 'a new question has no selected color');
    assert.equal(a.el(id).disabled, false);
  }
}

function assertMissedAnswer(a, field, values) {
  const correction = field === 'color' ? values.color === 'black' ? 'Dark' : 'Light' : values[field];
  assert.ok(a.el('sdFeedback').textContent.includes(`${labels[field]}: correct answer is ${correction}`),
    field + ' correction is displayed after a miss');
}

for (const platform of Object.keys(roots)) {
  test(platform + ': direct startup, fresh defaults, exact modes, and independent theme buttons', async t => {
    const store = storage(); let a = await open(platform, store); t.after(() => a.close());
    assert.equal(a.d.title, 'Square Drills');
    assert.equal(a.d.querySelectorAll('.module-panel').length, 1);
    assert.equal(a.d.querySelector('.module-panel').id, 'module-square-drills');
    assert.equal(a.d.querySelector('.module-nav, .nav-item, #moduleSelect, #themeToggle'), null);
    assert.equal(a.d.documentElement.dataset.theme, 'light');
    assert.equal(a.el('sdPrompt').textContent, 'Ready');
    assert.equal(a.el('sdAttempts').textContent, '0');
    assert.equal(a.el('sdCorrect').textContent, '0');
    assert.equal(a.el('sdTimerEnabled').checked, false);
    assert.equal(a.el('sdRemember').checked, true);
    assert.equal(a.el('sdPromptMode').value, 'algebraic');
    assert.equal(a.el('sdAnswerMode').value, 'all');
    assert.ok([...a.el('sdCustom').querySelectorAll('input')].every(input => input.checked));
    assert.deepEqual([...a.el('sdAnswerMode').options].map(x => x.textContent.trim()),
      ['All fields', 'Color + White descriptive', 'Color + Algebraic', 'Custom']);
    assert.deepEqual([...a.el('sdCustom').querySelectorAll('input[type=checkbox]')].map(x => x.value).sort(), [...notation].sort());
    assert.equal(a.d.querySelector('[id^="ccd"], [id^="inv"], [id*="Reveal"], [id*="reveal"]'), null);
    for (const script of a.d.querySelectorAll('script[src]')) {
      assert.doesNotMatch(script.src, /ccd-|inverted|match-tracker|local-calculations|steps-grade|score-percentage/);
    }
    assert.equal(a.el('themeLabel').textContent, 'Theme');
    assert.equal(a.el('themeLight').textContent, 'Light');
    assert.equal(a.el('themeDark').textContent, 'Dark');
    a.press('themeDark'); await a.settle(); assert.equal(a.d.documentElement.dataset.theme, 'dark');
    assert.equal(a.el('themeDark').getAttribute('aria-pressed'), 'true');
    assert.equal(a.el('sdColor').value, '', 'theme does not answer a question');
    a.close(); a = await open(platform, store);
    assert.equal(a.d.querySelector('.module-panel.active').id, 'module-square-drills');
    assert.equal(a.d.documentElement.dataset.theme, 'dark');
    a.press('themeLight'); await a.settle(); assert.equal(a.d.documentElement.dataset.theme, 'light');
    assert.equal(a.el('themeLight').getAttribute('aria-pressed'), 'true');
    assert.ok(!store.calls.some(call => /last-module/.test(call.url)));
  });

  test(platform + ': Light/Dark controls are above notation, selectable, and independent of the notation keypad', async t => {
    let a = await open(platform); t.after(() => a.close());
    const row = a.el('sdRowColor');
    assert.equal(a.el('sdColor').type, 'hidden');
    assert.equal(a.d.querySelector('label[for=sdColor]'), null, 'there is no inactive visible color input');
    assert.equal(a.el('sdColorLight').textContent.trim(), 'Light');
    assert.equal(a.el('sdColorDark').textContent.trim(), 'Dark');
    assert.doesNotMatch(a.el('module-square-drills').textContent, /Color\s*\(required\)|Dark\s*\/\s*black|Light\s*\/\s*white/i);
    for (const field of notation) {
      assert.ok(row.compareDocumentPosition(a.el('sdRow' + suffix(field))) & a.w.Node.DOCUMENT_POSITION_FOLLOWING,
        'color controls appear before ' + field);
    }
    for (const id of ['sdColorLight', 'sdColorDark']) {
      assert.ok(row.contains(a.el(id)), 'color button is inside the color row');
      assert.equal(a.el(id).disabled, true, 'color cannot be entered before Start');
      a.press(id);
      assert.equal(a.el('sdColor').value, '');
    }
    a.change('sdPromptMode', 'black'); a.press('sdNext'); await a.settle();
    a.key('algebraic', 'a'); a.key('algebraic', '1');
    const keypad = a.el('sdKeypad').textContent;
    a.press('sdColorLight'); await a.settle();
    assert.equal(a.el('sdColor').value, 'white');
    assert.equal(a.el('sdColorLight').getAttribute('aria-pressed'), 'true');
    assert.equal(a.el('sdColorDark').getAttribute('aria-pressed'), 'false');
    assert.equal(a.el('sdAlgebraic').value, 'a1', 'selecting color preserves notation');
    assert.equal(a.el('sdKeypad').textContent, keypad, 'color selection does not replace the notation keypad');
    a.press('sdColorDark'); await a.settle();
    assert.equal(a.el('sdColor').value, 'black');
    assert.equal(a.el('sdColorLight').getAttribute('aria-pressed'), 'false');
    assert.equal(a.el('sdColorDark').getAttribute('aria-pressed'), 'true');
    await a.w.ChessTools.flush(); const store = a.store; a.close(); a = await open(platform, store);
    assert.equal(a.d.activeElement, a.el('sdColorDark'), 'restoring focus uses the selected color button');
    a.press('sdColorDark'); await a.settle();
    assert.equal(a.el('sdColor').value, '', 'selecting the same color again clears it');
    assert.equal(a.el('sdColorDark').getAttribute('aria-pressed'), 'false');
    assert.equal(a.el('sdKeypad').textContent, keypad);
    assert.equal(a.el('sdKeypad').querySelector('.color-keys'), null, 'keypad contains notation only');
    chooseMode(a, modeCases.find(c => c.mode === 'custom' && c.mask === 0));
    await a.settle();
    assert.equal(a.el('sdKeypad').hidden, true, 'color-only mode does not require a second keypad');
    assert.equal(row.hidden, false);
    a.press('sdColorLight'); await a.settle(); assert.equal(a.el('sdColor').value, 'white');
  });

  test(platform + ': missed answers appear only after Submit, survive locked reopen, and clear on Next', async t => {
    const store = storage(); let a = await open(platform, store); t.after(() => a.close());
    for (const prompt of notation) {
      a.change('sdPromptMode', prompt); a.press('sdNext'); await a.settle();
      const values = expected(a.state().current), required = requiredFor(a, modeCases[0]);
      const wrong = Object.fromEntries(fields.map(field => [field,
        field === 'color' ? values.color === 'black' ? 'white' : 'black'
          : field === 'algebraic' ? values[field] === 'a1' ? 'b2' : 'a1'
            : values[field] === 'K1' ? 'Q2' : 'K1']));
      assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
      answer(a, wrong, required); await a.settle();
      assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.', 'entering an answer exposes no correction');
      assert.equal(a.el('sd' + suffix(prompt)).value, '', 'prompted notation is not prefilled');
      const submitted = fields.map(field => a.el('sd' + suffix(field)).value);
      a.press('sdSubmit'); await a.settle();
      for (const field of required) assertMissedAnswer(a, field, values);
      assert.ok(!a.el('sdFeedback').textContent.includes(labels[prompt] + ':'), 'prompted notation is excluded from feedback');
      assert.deepEqual(fields.map(field => a.el('sd' + suffix(field)).value), submitted, 'corrections leave entered answers intact');
      const feedback = a.el('sdFeedback').textContent;
      a.close(); a = await open(platform, store);
      assert.equal(a.el('sdFeedback').textContent, feedback, 'locked restore recomputes the same correct answers');
      assert.deepEqual(fields.map(field => a.el('sd' + suffix(field)).value), submitted);
      assert.equal(a.el(colorButton(wrong.color)).getAttribute('aria-pressed'), 'true');
      assert.equal(a.el('sdColorLight').disabled, true); assert.equal(a.el('sdColorDark').disabled, true);
      a.press('sdNext'); await a.settle();
      assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
      assertFreshFields(a, requiredFor(a, modeCases[0]));
    }
  });

  test(platform + ': all preset/custom sets and fixed/random prompts use one effective answer set', async t => {
    const a = await open(platform); t.after(() => a.close());
    let attempts = 0;
    for (const c of modeCases) {
      for (const prompt of [...notation, 'random']) {
        if (a.el('sdSubmit').disabled && a.el('sdNext').textContent.trim() !== 'Start') a.press('sdNext');
        chooseMode(a, c); a.change('sdPromptMode', prompt); a.press('sdNext'); await a.settle();
        const allowed = eligible(c.selected), actual = a.state().shownPrompt.format;
        const tag = `${c.mode}/${c.mask ?? '-'}/${prompt}`;
        assert.ok(allowed.includes(actual), tag + ': actual prompt is eligible');
        if (prompt === 'random') assert.equal(a.el('sdPromptMode').value, 'random');
        else {
          assert.ok(allowed.includes(a.el('sdPromptMode').value), tag + ': visible selector corrected');
          if (allowed.includes(prompt)) assert.equal(actual, prompt, tag + ': fixed prompt honored');
        }
        const values = expected(a.state().current), required = requiredFor(a, c);
        assertFreshFields(a, required);
        assert.equal(a.el('sdPrompt').textContent.trim(), values[actual]);
        if (actual !== 'algebraic') assert.match(a.el('sdPromptType').textContent.toLowerCase(), new RegExp(actual));
        // Deliberately corrupt the supplied notation in its hidden input. It
        // must be excluded from validation as well as the visible answer set.
        a.el('sd' + suffix(actual)).value = 'invalid-hidden-answer';
        answer(a, values, required); a.press('sdSubmit'); await a.settle();
        assert.equal(Number(a.el('sdAttempts').textContent), ++attempts, tag);
        assert.equal(Number(a.el('sdCorrect').textContent), attempts, tag + ': mouse/touch answers accepted');
        assert.match(a.el('sdFeedback').textContent, /^Correct/);
        assert.equal(a.el('sdAccuracy').textContent, '100%');
      }
    }
  });

  test(platform + ': mandatory color counts blank/wrong as a wrong question in every mode', async t => {
    const a = await open(platform); t.after(() => a.close());
    let attempts = 0;
    for (const c of modeCases) for (const colorCase of ['blank', 'wrong']) {
      if (a.el('sdSubmit').disabled && a.state()?.current) a.press('sdNext');
      chooseMode(a, c); a.press('sdNext'); await a.settle();
      const values = expected(a.state().current);
      answer(a, values, requiredFor(a, c), colorCase === 'blank' ? '' : values.color === 'black' ? 'white' : 'black');
      a.press('sdSubmit'); await a.settle();
      assert.equal(Number(a.el('sdAttempts').textContent), ++attempts);
      assert.equal(Number(a.el('sdCorrect').textContent), 0, c.mode + ': ' + colorCase + ' color cannot be correct');
      assert.match(a.el('sdFeedback').textContent, /^Incorrect/);
      assertMissedAnswer(a, 'color', values);
      assert.equal(a.el('sdColor').value, colorCase === 'blank' ? '' : values.color === 'black' ? 'white' : 'black',
        'feedback does not overwrite the submitted color');
    }
    assert.equal(a.el('sdAccuracy').textContent, '0%');
  });

  test(platform + ': Random prompt endpoints stay eligible for every answer selection', async t => {
    const a = await open(platform); t.after(() => a.close());
    for (const c of modeCases) {
      if (a.state()?.locked) a.press('sdNext');
      chooseMode(a, c);
      const allowed = eligible(c.selected), seen = new Set();
      for (const value of [0, 0.499999, 0.999999]) {
        if (a.state()?.locked) a.press('sdNext');
        a.w.Math.random = () => value;
        a.change('sdPromptMode', 'random'); a.press('sdNext'); await a.settle();
        const format = a.state().shownPrompt.format; seen.add(format);
        assert.ok(allowed.includes(format));
        assertFreshFields(a, requiredFor(a, c));
        a.press('sdSubmit'); await a.settle();
      }
      assert.deepEqual([...seen].sort(), [...allowed].sort());
    }
  });

  test(platform + ': blank/incorrect required notation counts as one wrong question', async t => {
    const a = await open(platform); t.after(() => a.close());
    let attempts = 0;
    for (const prompt of notation) for (const field of notation.filter(key => key !== prompt)) {
      for (const kind of ['blank', 'wrong']) {
        if (a.state()?.locked) a.press('sdNext');
        a.change('sdPromptMode', prompt); a.press('sdNext'); await a.settle();
        const values = expected(a.state().current);
        answer(a, values, requiredFor(a, modeCases[0])); a.key(field, 'Clear answer');
        if (kind === 'wrong') {
          const wrong = field === 'algebraic' ? (values[field][0] === 'a' ? 'b' : 'a')
            : (values[field].slice(0, -1) === 'K' ? 'Q' : 'K');
          a.key(field, wrong); a.key(field, values[field].slice(-1));
        }
        a.press('sdSubmit'); a.press('sdSubmit'); await a.settle();
        assert.equal(a.state().attempts, ++attempts);
        assert.equal(a.state().correct, 0, field + ' ' + kind + ' cannot pass');
        assert.match(a.el('sdFeedback').textContent, /^Incorrect/);
        assertMissedAnswer(a, field, values);
      }
    }
  });

  test(platform + ': Next cannot skip an ungraded square, including injected clicks and partial answers', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.change('sdPromptMode', 'black'); a.press('sdNext'); await a.settle();
    const first = a.state().current, cycle = [...a.state().cycle];
    for (const timer of [false, true]) {
      a.check('sdTimerEnabled', timer);
      a.key('algebraic', 'c');
      a.press('sdNext'); a.el('sdNext').dispatchEvent(new a.w.Event('click'));
      await a.settle();
      assert.equal(a.state().current, first); assert.equal(a.state().index, 1);
      assert.equal(a.state().attempts, 0); assert.equal(a.el('sdAlgebraic').value, 'c');
      assert.equal(a.el('sdNext').disabled, true);
    }
    a.check('sdTimerEnabled', false); a.press('sdSubmit'); await a.settle();
    assert.equal(a.state().attempts, 1); assert.equal(a.el('sdNext').disabled, false);
    a.press('sdNext'); await a.settle();
    assert.equal(a.state().current, cycle[1]); assert.equal(a.state().index, 2);
    assert.equal(a.state().attempts, 1);
  });

  test(platform + ': confirmed Reset session restarts the same order and Reshuffle starts a fresh order', async t => {
    const a = await open(platform); t.after(() => a.close());
    chooseMode(a, modeCases.find(c => c.mode === 'custom' && c.mask === 0));
    a.change('sdPromptMode', 'black'); a.check('sdTimerEnabled', true);
    a.press('themeDark'); a.press('sdNext'); await a.settle();
    const cycle = [...a.state().cycle];
    a.press(colorButton(expected(a.state().current).color)); await a.settle();
    a.press(colorButton(expected(a.state().current).color)); await a.settle();
    const before = structuredClone(a.state());
    assert.equal(before.attempts, 2);
    assert.equal(a.el('sdReset').textContent.trim(), 'Reset session');
    a.confirm(false); a.press('sdReset'); await a.settle(); assert.deepEqual(a.state(), before);
    a.confirm(true); a.press('sdReset'); await a.settle();
    assert.deepEqual([...a.state().cycle], cycle);
    assert.equal(a.state().current, cycle[0]); assert.equal(a.state().index, 1);
    assert.equal(a.state().attempts, 0); assert.equal(a.state().correct, 0);
    assert.deepEqual(a.state().sessionResults, {}); assert.equal(a.state().completed, false);
    assert.equal(a.state().locked, false); assert.equal(a.el('sdTimer').textContent, '00:00.0');
    assert.equal(a.el('sdSessionResults').hidden, true);
    a.press('sdReshuffle'); await a.settle();
    assert.equal(a.state().index, 1); assert.equal(a.state().current, a.state().cycle[0]);
    assert.notDeepEqual([...a.state().cycle], cycle);
    assert.equal(new Set(a.state().cycle).size, 64);
    assert.equal(a.state().attempts, 0); assert.equal(a.state().correct, 0);
    for (const key of ['answerMode', 'promptMode', 'timerEnabled', 'remember']) assert.equal(a.state()[key], before[key]);
    assert.deepEqual(a.state().custom, before.custom);
    assert.equal(a.d.documentElement.dataset.theme, 'dark');
  });

  test(platform + ': corrections, focus, and duplicate-submit/answer locking', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.change('sdPromptMode', 'black'); a.press('sdNext'); await a.settle();
    for (const field of notation) {
      assert.equal(a.el('sd' + suffix(field)).readOnly, platform === 'Android');
      if (platform === 'Android') assert.equal(a.el('sd' + suffix(field)).inputMode, 'none');
    }
    assert.equal(a.d.activeElement, a.el('sdColorLight'));
    a.key('algebraic', 'h'); a.key('algebraic', '8'); assert.equal(a.el('sdAlgebraic').value, 'h8');
    a.key('algebraic', 'a'); assert.equal(a.el('sdAlgebraic').value, 'a8');
    a.key('algebraic', '1'); assert.equal(a.el('sdAlgebraic').value, 'a1');
    a.key('algebraic', 'Clear answer'); assert.equal(a.el('sdAlgebraic').value, '');
    assert.equal(a.el('sdWhite').value, '', 'entering algebraic never fills descriptive');
    a.key('white', 'QN'); a.key('white', '8'); a.key('white', 'KR'); a.key('white', '1');
    assert.equal(a.el('sdWhite').value, 'KR1'); a.key('white', 'Clear answer');
    a.el('sdAlgebraic').focus(); a.change('sdPromptMode', 'algebraic'); await a.settle();
    assert.equal(a.el('sdRowAlgebraic').hidden, true);
    assert.notEqual(a.d.activeElement, a.el('sdAlgebraic'), 'hidden field relinquishes keypad focus');
    answer(a, expected(a.state().current), requiredFor(a, modeCases[0]));
    a.press('sdSubmit'); a.press('sdSubmit');
    a.el('sdSubmit').dispatchEvent(new a.w.Event('click')); await a.settle();
    assert.equal(a.state().attempts, 1); assert.equal(a.state().correct, 1);
    const answers = fields.map(field => a.el('sd' + suffix(field)).value);
    assert.equal(a.el('sdSubmit').disabled, true);
    for (const field of fields) assert.equal(a.el('sd' + suffix(field)).disabled, true);
    for (const id of ['sdColorLight', 'sdColorDark']) {
      assert.equal(a.el(id).disabled, true);
      a.press(id);
      a.el(id).dispatchEvent(new a.w.Event('click'));
    }
    assert.ok([...a.el('sdKeypad').querySelectorAll('button')].every(button => button.disabled));
    for (const button of a.el('sdKeypad').querySelectorAll('button')) button.click();
    assert.deepEqual(fields.map(field => a.el('sd' + suffix(field)).value), answers);
    const settings = [a.el('sdAnswerMode').value, a.el('sdPromptMode').value];
    a.change('sdAnswerMode', 'custom'); a.change('sdPromptMode', 'black'); await a.settle();
    assert.deepEqual([a.el('sdAnswerMode').value, a.el('sdPromptMode').value], settings, 'submitted settings cannot change scoring');
    assert.deepEqual(fields.map(field => a.el('sd' + suffix(field)).value), answers);
    a.press('sdNext'); await a.settle();
    assert.equal(a.el('sdSubmit').disabled, false); assertFreshFields(a, requiredFor(a, modeCases[0]));
    assert.equal(a.d.activeElement, a.el('sdColorLight'));
  });

  test(platform + ': fresh drill identity; unfinished/locked answers survive reopen, clear stays scoped', async t => {
    const store = storage();
    store.states['ccd-full'] = { current: 'e4', attempts: 99, correct: 99, answerMode: 'TOURN', revealed: true };
    store.states['ccd-inverted'] = { attempts: 88, promptMode: 'B' };
    store.states['match-tracker'] = { remember: true, nameA: 'Player A', nameB: 'Player B', results: ['D'] };
    store.settings.lastModule = 'ccd-inverted';
    let a = await open(platform, store); t.after(() => a.close());
    assert.equal(a.d.querySelector('.module-panel.active').id, 'module-square-drills');
    assert.equal(a.el('sdAnswerMode').value, 'all'); assert.equal(a.el('sdAttempts').textContent, '0');
    assert.ok(!store.calls.some(call => /\/api\/state\/ccd-/.test(call.url)), 'retired storage is never imported');
    a.change('sdPromptMode', 'black'); a.press('sdNext'); a.key('algebraic', 'c'); await a.settle();
    const current = a.state().current;
    a.close(); a = await open(platform, store);
    assert.equal(a.el('sdAlgebraic').value, 'c'); assert.equal(a.state().current, current);
    answer(a, expected(current), requiredFor(a, modeCases[0])); a.press('sdSubmit'); await a.settle();
    a.close(); a = await open(platform, store);
    assert.equal(a.el('sdSubmit').disabled, true); assert.match(a.el('sdFeedback').textContent, /^Correct/);
    assert.equal(a.el('sdAlgebraic').value, current); assert.equal(Number(a.el('sdAttempts').textContent), 1);
    a.check('sdRemember', false); await a.settle();
    const saved = structuredClone(a.state()); a.press('sdNext'); await a.settle(300);
    if (a.w.MobileUI) a.w.MobileUI.flush();
    await a.settle(); assert.deepEqual(a.state(), saved, 'paused remembering preserves prior snapshot');
    const unrelated = Object.fromEntries(Object.entries(store.states).filter(([id]) => id !== 'square-drills'));
    a.confirm(false); a.press('sdClearSaved'); await a.settle(); assert.deepEqual(a.state(), saved);
    a.confirm(true); a.press('sdClearSaved'); await a.settle();
    assert.equal(a.state(), undefined); assert.equal(a.el('sdAttempts').textContent, '0');
    assert.deepEqual(Object.fromEntries(Object.entries(store.states).filter(([id]) => id !== 'square-drills')), unrelated);
  });

  test(platform + ': legacy 82/39 progress is discarded once while settings and subsequent v2 progress are preserved', async t => {
    const store = storage();
    const cycle = Array.from({ length: 8 }, (_, rank) => [...'abcdefgh'].map(file => `${file}${rank + 1}`)).flat();
    store.settings.theme = 'dark';
    store.states['square-drills'] = {
      remember: false, promptMode: 'algebraic', answerMode: 'custom',
      custom: { algebraic: false, white: false, black: true }, cycle, index: 29, current: 'e4',
      shownPrompt: { format: 'algebraic', text: 'e4', label: 'Algebraic' },
      attempts: 82, correct: 39, locked: true,
      answers: { color: 'white', algebraic: '', white: '', black: 'K5' },
      timerEnabled: true, timerElapsed: 12345, activeField: 'black',
    };
    let a = await open(platform, store); t.after(() => a.close());
    assert.equal(a.el('sdPrompt').textContent, 'Ready');
    assert.equal(a.el('sdAttempts').textContent, '0'); assert.equal(a.el('sdCorrect').textContent, '0');
    assert.equal(a.el('sdTimer').textContent, '00:00.0');
    assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
    assert.equal(a.el('sdSessionResults').hidden, true);
    assert.equal(a.el('sdRemember').checked, false); assert.equal(a.el('sdTimerEnabled').checked, true);
    assert.equal(a.el('sdPromptMode').value, 'algebraic'); assert.equal(a.el('sdAnswerMode').value, 'custom');
    assert.equal(a.d.documentElement.dataset.theme, 'dark');
    assert.deepEqual(a.state().custom, { algebraic: false, white: false, black: true });
    assert.equal(a.state().sessionVersion, 2); assert.equal(a.state().current, null); assert.equal(a.state().index, 0);
    assert.deepEqual(a.state().sessionResults, {}); assert.equal(a.state().completed, false);
    assert.equal(a.state().attempts, 0); assert.equal(a.state().correct, 0);
    assert.equal(store.calls.filter(call => call.url === '/api/state/square-drills' && call.method === 'PUT').length, 1,
      'approved one-time replacement persists even while Remember is off');
    assert.ok(store.calls.every(call => ['/api/health', '/api/settings/theme', '/api/state/square-drills'].includes(call.url)),
      'migration does not create a backup or contact other state routes');
    await a.advance(2000); assert.equal(a.el('sdTimer').textContent, '00:00.0');
    a.check('sdRemember', true); a.press('sdNext'); a.key('black', 'K'); a.check('sdRemember', false);
    await a.settle(); const saved = structuredClone(a.state()); a.close();
    a = await open(platform, store);
    assert.equal(a.state().sessionVersion, 2); assert.equal(a.state().current, saved.current);
    assert.equal(a.el('sdBlack').value, 'K'); assert.equal(a.el('sdRemember').checked, false);
    assert.equal(a.el('sdAttempts').textContent, '0'); assert.equal(a.d.documentElement.dataset.theme, 'dark');
    assert.deepEqual(a.state(), saved, 'already migrated state is not reset on the next launch');
  });

  for (const timed of [false, true]) {
    test(`${platform}: ${timed ? 'timed' : 'untimed'} final notation mistakes retain every correction and derive totals from the per-square map`, async t => {
      const store = storage();
      let a = await open(platform, store); t.after(() => a.close());
      a.check('sdTimerEnabled', timed); a.press('sdNext'); await a.settle();
      const fixture = structuredClone(a.state());
      fixture.sessionVersion = 2;
      fixture.sessionResults = Object.fromEntries(fixture.cycle.slice(0, 63).map((square, index) => [square, index % 3 !== 0]));
      fixture.completed = false; fixture.index = 64; fixture.current = fixture.cycle[63];
      fixture.attempts = 999; fixture.correct = 999;
      fixture.shownPrompt = { format: 'algebraic', text: fixture.current, label: 'Algebraic' };
      fixture.answers = { color: '', algebraic: '', white: '', black: '' };
      fixture.locked = false; fixture.results = null; fixture.timerElapsed = 1250;
      store.states['square-drills'] = fixture; a.close(); a = await open(platform, store);
      assert.equal(a.el('sdAttempts').textContent, '63'); assert.equal(a.el('sdCorrect').textContent, '42');
      const values = expected(fixture.current);
      const wrong = { ...values, color: values.color === 'black' ? 'white' : 'black',
        white: values.white === 'K1' ? 'Q2' : 'K1', black: values.black === 'K1' ? 'Q2' : 'K1' };
      answer(a, wrong, ['color', 'white', 'black']); if (!timed) a.press('sdSubmit'); await a.settle();
      assert.equal(a.state().attempts, 64); assert.equal(a.state().correct, 42); assert.equal(a.state().completed, true);
      for (const field of ['color', 'white', 'black']) assertMissedAnswer(a, field, values);
      assert.equal(a.el('sdWhite').value, wrong.white); assert.equal(a.el('sdBlack').value, wrong.black);
      assert.equal(a.state().sessionResults[fixture.current], false);
      assert.equal(a.el('sdSessionCorrect').textContent, '42'); assert.equal(a.el('sdSessionIncorrect').textContent, '22');
      assert.equal(a.el('sdSessionAccuracy').textContent, '66%');
      const feedback = a.el('sdFeedback').textContent;
      a.close(); a = await open(platform, store);
      assert.equal(a.el('sdFeedback').textContent, feedback); assert.equal(a.el('sdSessionResults').hidden, false);
      a.enter(); a.press('sdNext'); await a.settle(); assert.equal(a.state().attempts, 64);
    });
  }

  test(platform + ': timed complete answers advance without Submit, reset the clock, and save the new question', async t => {
    const store = storage(); let a = await open(platform, store); t.after(() => a.close());
    a.check('sdTimerEnabled', true); a.press('sdNext'); await a.settle();
    const first = a.state().current, index = a.state().index, resetTime = a.el('sdTimer').textContent;
    await a.advance(2300); assert.notEqual(a.el('sdTimer').textContent, resetTime);
    assert.equal(a.el('sdSubmit').hidden, true, 'timed drills do not show a Submit button');
    answer(a, expected(first), requiredFor(a, modeCases[0]));
    assert.equal(Number(a.el('sdCyclePosition').textContent), index + 1, 'advance occurs synchronously without a delay');
    assert.equal(a.el('sdAttempts').textContent, '1'); assert.equal(a.el('sdCorrect').textContent, '1');
    assert.equal(a.el('sdAccuracy').textContent, '100%');
    assert.equal(a.el('sdColorLight').disabled, false, 'next question is editable');
    assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
    assert.equal(a.el('sdTimer').textContent, resetTime, 'next question starts from zero elapsed time');
    await a.settle();
    const second = a.state().current;
    assert.notEqual(second, first); assert.equal(a.state().index, index + 1);
    assert.equal(a.state().attempts, 1); assert.equal(a.state().correct, 1);
    assert.equal(a.state().locked, false); assert.equal(a.state().results, null);
    assert.equal(a.state().timerElapsed, 0);
    assertFreshFields(a, requiredFor(a, modeCases[0]));
    a.close(); a = await open(platform, store);
    assert.equal(a.state().current, second, 'reopen resumes the automatically advanced question');
    assert.equal(a.state().index, index + 1); assert.equal(a.state().attempts, 1); assert.equal(a.state().correct, 1);
    assert.equal(a.el('sdTimerEnabled').checked, true); assert.equal(a.el('sdColorLight').disabled, false);
    assert.equal(a.el('sdSubmit').hidden, true); assert.equal(a.el('sdSubmit').disabled, true);
    assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
    assertFreshFields(a, requiredFor(a, modeCases[0]));
    const restoredTime = a.el('sdTimer').textContent;
    await a.advance(1600); assert.notEqual(a.el('sdTimer').textContent, restoredTime, 'new question clock continues running');
    assert.equal(a.state().attempts, 1, 'clock ticks do not submit or advance again');
    assert.equal(a.state().index, index + 1);
  });

  test(platform + ': timed color-only click advances immediately when correct and stays with correction when wrong', async t => {
    const store = storage(); let a = await open(platform, store); t.after(() => a.close());
    chooseMode(a, modeCases.find(c => c.mode === 'custom' && c.mask === 0));
    a.check('sdTimerEnabled', true); a.press('sdNext'); await a.settle();
    const first = a.state().current;
    a.press(colorButton(expected(first).color));
    assert.equal(a.el('sdCyclePosition').textContent, '2', 'one color tap immediately advances');
    assert.equal(a.el('sdAttempts').textContent, '1'); assert.equal(a.el('sdCorrect').textContent, '1');
    await a.settle();
    const current = a.state().current, index = a.state().index, values = expected(current);
    await a.advance(2100);
    const wrong = values.color === 'black' ? 'white' : 'black';
    a.press(colorButton(wrong)); await a.settle();
    assert.equal(a.state().current, current); assert.equal(a.state().index, index);
    assert.equal(a.state().attempts, 2); assert.equal(a.state().correct, 1); assert.equal(a.el('sdAccuracy').textContent, '50%');
    assert.equal(a.state().locked, true); assertMissedAnswer(a, 'color', values);
    assert.equal(a.el('sdColor').value, wrong); assert.equal(a.el(colorButton(wrong)).getAttribute('aria-pressed'), 'true');
    const stoppedTime = a.el('sdTimer').textContent;
    a.press('sdColorLight'); a.press('sdColorDark'); a.press('sdSubmit');
    a.el('sdColorLight').dispatchEvent(new a.w.Event('click'));
    a.el('sdColorDark').dispatchEvent(new a.w.Event('click'));
    await a.advance(3000);
    assert.equal(a.state().attempts, 2, 'locked clicks do not count again');
    assert.equal(a.el('sdTimer').textContent, stoppedTime); assert.equal(a.el('sdColor').value, wrong);
    a.close(); a = await open(platform, store);
    assert.equal(a.state().current, current); assert.equal(a.state().index, index);
    assert.equal(a.state().attempts, 2); assert.equal(a.state().correct, 1); assertMissedAnswer(a, 'color', values);
    assert.equal(a.el('sdColorLight').disabled, true); assert.equal(a.el('sdColorDark').disabled, true);
    assert.equal(a.el('sdTimer').textContent, stoppedTime);
    a.check('sdTimerEnabled', false); a.check('sdTimerEnabled', true); await a.advance(1000);
    assert.equal(a.state().current, current); assert.equal(a.state().index, index, 'timer toggle cannot advance a locked answer');
    assert.equal(a.el('sdTimer').textContent, stoppedTime); assert.equal(a.state().attempts, 2);
    a.press('sdNext'); await a.settle();
    assert.equal(a.state().index, index + 1); assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
  });

  test(platform + ': timed mixed fields wait for complete notation and color, including rank-first entry and Enter', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.change('sdPromptMode', 'black'); a.check('sdTimerEnabled', true); a.press('sdNext'); await a.settle();
    const values = expected(a.state().current), index = a.state().index;
    a.key('algebraic', values.algebraic.slice(-1)); a.enter(a.el('sdAlgebraic')); await a.settle();
    assert.equal(a.state().attempts, 0); assert.equal(a.state().index, index, 'rank alone is incomplete');
    a.key('algebraic', values.algebraic[0]); await a.settle();
    assert.equal(a.state().attempts, 0, 'complete algebraic alone does not grade');
    a.key('white', values.white.slice(0, -1)); a.enter(a.el('sdWhite')); await a.settle();
    assert.equal(a.state().attempts, 0, 'descriptive file alone is incomplete');
    a.key('white', values.white.slice(-1)); a.enter(); await a.settle();
    assert.equal(a.state().attempts, 0, 'both notations still require a color choice');
    assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
    a.press(colorButton(values.color)); await a.settle();
    assert.equal(a.state().attempts, 1); assert.equal(a.state().correct, 1); assert.equal(a.state().index, index + 1);
  });

  test(platform + ': timed complete wrong answers grade once on the final input and remain locked', async t => {
    const a = await open(platform); t.after(() => a.close()); a.check('sdTimerEnabled', true);
    let attempts = 0;
    for (const missed of ['color', 'white', 'black']) {
      a.press('sdNext'); await a.settle();
      const current = a.state().current, index = a.state().index, values = expected(current);
      const wrong = { ...values, [missed]: missed === 'color' ? values.color === 'black' ? 'white' : 'black'
        : values[missed] === 'K1' ? 'Q2' : 'K1' };
      const preceding = requiredFor(a, modeCases[0]).filter(field => field !== missed);
      answer(a, values, preceding); await a.settle();
      assert.equal(a.state().attempts, attempts, 'other complete fields wait for the final required answer');
      await a.advance(1800);
      if (missed === 'color') a.press(colorButton(wrong.color));
      else {
        a.key(missed, wrong[missed].slice(0, -1)); a.enter(a.el('sd' + suffix(missed))); await a.settle();
        assert.equal(a.state().attempts, attempts, 'partial wrong notation is not prematurely graded');
        a.key(missed, wrong[missed].slice(-1));
      }
      await a.settle();
      assert.equal(a.state().attempts, ++attempts); assert.equal(a.state().correct, 0);
      assert.equal(a.state().current, current); assert.equal(a.state().index, index); assertMissedAnswer(a, missed, values);
      assert.equal(a.state().locked, true);
      const submitted = fields.map(field => a.el('sd' + suffix(field)).value), stopped = a.el('sdTimer').textContent;
      for (const id of ['sdColorLight', 'sdColorDark', 'sdSubmit']) a.press(id);
      for (const field of notation) a.change('sd' + suffix(field), 'Q9', 'input');
      await a.advance(1200);
      assert.equal(a.state().attempts, attempts); assert.equal(a.el('sdTimer').textContent, stopped);
      assert.deepEqual(fields.map(field => a.el('sd' + suffix(field)).value), submitted);
    }
  });

  test(platform + ': every timed preset/custom set and fixed/random prompt grades on the last required input', async t => {
    const a = await open(platform); t.after(() => a.close()); a.check('sdTimerEnabled', true);
    let attempts = 0;
    for (const c of modeCases) for (const prompt of [...notation, 'random']) {
      chooseMode(a, c); a.change('sdPromptMode', prompt); a.press('sdNext'); await a.settle();
      const index = a.state().index, values = expected(a.state().current);
      const required = requiredFor(a, c);
      if (attempts % 2) required.reverse();
      for (const [i, field] of required.entries()) {
        if (field === 'color') a.press(colorButton(values.color));
        else {
          a.key(field, values[field].slice(0, -1));
          assert.equal(Number(a.el('sdAttempts').textContent), attempts, 'file-only entry does not grade');
          a.key(field, values[field].slice(-1));
        }
        assert.equal(Number(a.el('sdAttempts').textContent), attempts + (i === required.length - 1 ? 1 : 0),
          `${c.mode}/${c.mask ?? '-'}/${prompt}: grade only when all fields are complete`);
      }
      await a.settle();
      assert.equal(a.state().attempts, ++attempts); assert.equal(a.state().correct, attempts);
      assert.equal(a.state().index, index + 1); assert.equal(a.state().locked, false);
      assertFreshFields(a, requiredFor(a, c));
    }
  });

  for (const timed of [false, true]) for (const finalCorrect of [false, true]) {
    test(`${platform}: ${timed ? 'timed' : 'untimed'} session stops after all 64 unique answers with a ${finalCorrect ? 'correct' : 'wrong'} final answer`, async t => {
      const store = storage(); let a = await open(platform, store); t.after(() => a.close());
      chooseMode(a, modeCases.find(c => c.mode === 'custom' && c.mask === 0));
      a.change('sdPromptMode', 'black'); a.check('sdTimerEnabled', timed);
      a.press('themeDark'); a.press('sdNext'); await a.settle();
      const seen = [], outcomes = {}, cycle = [...a.state().cycle];
      let correct = 0;
      for (let i = 0; i < 64; i++) {
        const current = a.state().current, values = expected(current);
        assert.equal(a.state().index, i + 1); assert.equal(current, cycle[i]);
        assert.equal(seen.includes(current), false); seen.push(current);
        assert.equal(a.el('sdSessionResults').hidden, true);
        a.press('sdNext'); a.el('sdNext').dispatchEvent(new a.w.Event('click')); await a.settle();
        assert.equal(a.state().current, current, 'every square must be graded before advancing');
        const passed = i === 63 ? finalCorrect : i % 7 !== 0;
        outcomes[current] = passed; if (passed) correct += 1;
        const submittedColor = passed ? values.color : values.color === 'black' ? 'white' : 'black';
        a.press(colorButton(submittedColor));
        if (!timed) a.press('sdSubmit');
        await a.settle();
        assert.equal(a.state().attempts, i + 1); assert.equal(a.state().correct, correct);
        assert.equal(Object.keys(a.state().sessionResults).length, i + 1);
        assert.equal(a.state().sessionResults[current], passed);
        if (!passed) assertMissedAnswer(a, 'color', values);
        if (i < 63) {
          assert.equal(a.state().completed, false);
          if (timed && passed) {
            assert.equal(a.state().index, i + 2); assert.equal(a.state().locked, false);
            assert.equal(a.el('sdColor').value, '');
          } else {
            assert.equal(a.state().current, current); assert.equal(a.state().locked, true);
            a.press('sdNext'); await a.settle();
            assert.equal(a.state().index, i + 2);
          }
        } else {
          assert.equal(a.state().current, current); assert.equal(a.state().index, 64);
          assert.equal(a.el('sdColor').value, submittedColor, 'final submitted answer stays visible');
        }
      }
      assert.equal(new Set(seen).size, 64);
      assert.equal(a.state().sessionVersion, 2);
      assert.deepEqual(a.state().sessionResults, outcomes);
      assert.equal(a.state().completed, true); assert.equal(a.state().locked, true);
      assert.equal(a.el('sdSessionResults').hidden, false);
      assert.equal(Number(a.el('sdSessionAttempts').textContent), 64);
      assert.equal(Number(a.el('sdSessionCorrect').textContent), correct);
      assert.equal(Number(a.el('sdSessionIncorrect').textContent), 64 - correct);
      assert.equal(a.el('sdSessionAccuracy').textContent, `${Math.round(correct / 64 * 100)}%`);
      assert.equal(a.el('sdCycleProgress').style.width, '100%');
      assert.equal(a.el('sdNext').disabled, true); assert.equal(a.el('sdSubmit').disabled, true);
      assert.equal(a.el('sdReset').disabled, true, 'completed sessions can restart only through Reshuffle');
      for (const id of ['sdColorLight', 'sdColorDark', 'sdAlgebraic', 'sdWhite', 'sdBlack', 'sdPromptMode', 'sdAnswerMode']) {
        assert.equal(a.el(id).disabled, true, id + ' stays disabled at completion');
      }
      const feedback = a.el('sdFeedback').textContent, stopped = a.el('sdTimer').textContent;
      for (let i = 0; i < 3; i++) {
        a.press('sdNext'); a.el('sdNext').dispatchEvent(new a.w.Event('click'));
        a.enter(); a.press('sdSubmit'); a.el('sdSubmit').dispatchEvent(new a.w.Event('click'));
        a.press('sdColorLight'); a.press('sdColorDark');
        a.press('sdReset'); a.el('sdReset').dispatchEvent(new a.w.Event('click'));
      }
      a.check('sdTimerEnabled', !timed); a.check('sdTimerEnabled', timed);
      await a.advance(3000); await a.w.ChessTools.flush();
      assert.equal(a.state().index, 64); assert.equal(a.state().current, cycle[63]);
      assert.equal(a.state().attempts, 64); assert.equal(a.state().correct, correct);
      assert.deepEqual(a.state().cycle, cycle); assert.deepEqual(a.state().sessionResults, outcomes);
      assert.equal(a.el('sdFeedback').textContent, feedback); assert.equal(a.el('sdTimer').textContent, stopped);
      a.close(); a = await open(platform, store);
      assert.equal(a.el('sdSessionResults').hidden, false);
      assert.equal(a.el('sdNext').disabled, true); assert.equal(a.el('sdFeedback').textContent, feedback);
      a.enter(); await a.advance(2000);
      assert.equal(a.state().attempts, 64); assert.equal(a.state().current, cycle[63]);
      assert.equal(a.el('sdTimer').textContent, stopped);
      const prefs = structuredClone(a.state());
      a.press('sdReshuffle'); await a.settle();
      assert.equal(a.state().attempts, 0); assert.equal(a.state().correct, 0);
      assert.equal(a.state().completed, false); assert.deepEqual(a.state().sessionResults, {});
      assert.equal(a.state().index, 1); assert.equal(a.state().current, a.state().cycle[0]);
      assert.equal(a.state().locked, false); assert.equal(a.el('sdSessionResults').hidden, true);
      assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
      assert.notDeepEqual(a.state().cycle, cycle); assert.equal(new Set(a.state().cycle).size, 64);
      for (const key of ['answerMode', 'promptMode', 'timerEnabled', 'remember']) assert.equal(a.state()[key], prefs[key]);
      assert.deepEqual(a.state().custom, prefs.custom); assert.equal(a.d.documentElement.dataset.theme, 'dark');
    });
  }

  test(platform + ': timer-off correct submissions remain manual even if the timer is then enabled', async t => {
    const a = await open(platform); t.after(() => a.close());
    assert.equal(a.el('sdTimerEnabled').checked, false); a.press('sdNext'); await a.settle();
    const current = a.state().current, index = a.state().index;
    answer(a, expected(current), requiredFor(a, modeCases[0])); await a.settle();
    assert.equal(a.state().attempts, 0, 'timer-off answers are not automatically graded');
    assert.equal(a.el('sdSubmit').hidden, false); assert.equal(a.el('sdSubmit').disabled, false);
    a.press('sdSubmit'); await a.settle();
    assert.equal(a.state().attempts, 1); assert.equal(a.state().correct, 1); assert.equal(a.state().locked, true);
    assert.equal(a.state().current, current); assert.equal(a.state().index, index);
    assert.match(a.el('sdFeedback').textContent, /^Correct/); assert.equal(a.el('sdSubmit').disabled, true);
    a.check('sdTimerEnabled', true); await a.advance(3000);
    assert.equal(a.state().current, current); assert.equal(a.state().index, index, 'enabling the timer is not a new submission');
    assert.equal(a.el('sdTimer').textContent, '00:00.0'); assert.equal(a.state().attempts, 1);
    a.press('sdNext'); await a.settle(); assert.equal(a.state().index, index + 1); assert.equal(a.el('sdColorLight').disabled, false);
    assert.equal(a.el('sdSubmit').hidden, true);
  });

  test(platform + ': changing the timer setting does not grade already-complete answers', async t => {
    const a = await open(platform); t.after(() => a.close()); a.press('sdNext'); await a.settle();
    const current = a.state().current, index = a.state().index;
    answer(a, expected(current), requiredFor(a, modeCases[0])); await a.settle();
    for (const enabled of [true, false, true, false]) {
      a.check('sdTimerEnabled', enabled); await a.advance(1200);
      assert.equal(a.state().attempts, 0); assert.equal(a.state().correct, 0);
      assert.equal(a.state().current, current); assert.equal(a.state().index, index);
      assert.equal(a.el('sdSubmit').hidden, enabled);
      assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
    }
    a.press('sdSubmit'); await a.settle();
    assert.equal(a.state().attempts, 1); assert.equal(a.state().correct, 1); assert.equal(a.state().locked, true);
  });

  test(platform + ': elapsed timer enable/disable, next, submission and background pause', async t => {
    const store = storage(); let a = await open(platform, store); t.after(() => a.close());
    assert.equal(a.el('sdTimerEnabled').checked, false);
    a.press('sdNext'); await a.settle(); const off = a.el('sdTimer').textContent;
    await a.advance(3000); assert.equal(a.el('sdTimer').textContent, off);
    a.check('sdTimerEnabled', true); await a.advance(2500);
    const running = a.el('sdTimer').textContent; assert.notEqual(running, off, 'enabled timer advances');
    a.check('sdTimerEnabled', false); await a.settle(); const paused = a.el('sdTimer').textContent;
    await a.advance(5000); assert.equal(a.el('sdTimer').textContent, paused, 'disabled timer pauses');
    a.check('sdTimerEnabled', true); await a.advance(2000);
    assert.notEqual(a.el('sdTimer').textContent, paused, 're-enabled timer resumes');
    await a.visibility(true); const background = a.el('sdTimer').textContent;
    await a.advance(5000); assert.equal(a.el('sdTimer').textContent, background, 'background pauses');
    await a.visibility(false); await a.advance(2000); assert.notEqual(a.el('sdTimer').textContent, background);
    if (platform === 'Android') {
      a.d.dispatchEvent(new a.w.Event('chess-mobile-pause')); await a.settle();
      const nativePause = a.el('sdTimer').textContent;
      await a.advance(5000); assert.equal(a.el('sdTimer').textContent, nativePause, 'native pause stops clock');
      a.d.dispatchEvent(new a.w.Event('chess-mobile-resume')); await a.advance(2000);
      assert.notEqual(a.el('sdTimer').textContent, nativePause, 'native resume restarts clock');
    }
    answer(a, expected(a.state().current), requiredFor(a, modeCases[0])); await a.settle();
    assert.equal(a.el('sdTimer').textContent, off, 'a correctly graded question resets the next question timer');
    await a.advance(2000);
    const values = expected(a.state().current);
    answer(a, values, requiredFor(a, modeCases[0]), values.color === 'black' ? 'white' : 'black');
    await a.settle(); const submitted = a.el('sdTimer').textContent;
    await a.advance(5000); assert.equal(a.el('sdTimer').textContent, submitted, 'submitted question timer stops');
    a.check('sdTimerEnabled', false); a.check('sdTimerEnabled', true); await a.advance(2000);
    assert.equal(a.el('sdTimer').textContent, submitted, 'timer toggle cannot restart a submitted question');
    a.close(); a = await open(platform, store);
    assert.equal(a.el('sdTimerEnabled').checked, true); assert.equal(a.el('sdTimer').textContent, submitted);
    await a.advance(3000); assert.equal(a.el('sdTimer').textContent, submitted, 'restored locked timer remains stopped');
  });


}

test('Windows: optional typed normalization and Enter flow use the same scoring', async t => {
  const a = await open('Windows'); t.after(() => a.close());
  a.enter(); await a.settle(); assert.equal(a.state().index, 1);
  for (const prompt of notation) {
    a.change('sdPromptMode', prompt); await a.settle();
    const values = expected(a.state().current), required = requiredFor(a, modeCases[0]);
    for (const field of required) {
      if (field === 'color') { a.press(colorButton(values.color)); continue; }
      const value = field === 'algebraic' ? ' ' + values[field].toUpperCase() + ' ' : values[field].toLowerCase();
      a.change('sd' + suffix(field), value, 'input');
    }
    a.enter(a.el('sd' + suffix(required.find(field => field !== 'color'))));
    await a.settle(); assert.match(a.el('sdFeedback').textContent, /^Correct/);
    const before = Number(a.el('sdAttempts').textContent);
    a.enter(); await a.settle(); assert.equal(a.el('sdSubmit').disabled, false);
    assert.equal(Number(a.el('sdAttempts').textContent), before, 'Enter after a locked result advances rather than resubmitting');
  }
  const current = a.state().current;
  a.enter(a.el('sdPromptMode')); await a.settle(); assert.equal(a.state().current, current, 'Enter in settings does not trigger the drill handler');
});

test('Windows: timed typing waits for complete notation and grades normalized or invalid complete tokens without Submit', async t => {
  const a = await open('Windows'); t.after(() => a.close()); a.check('sdTimerEnabled', true);
  let attempts = 0, correct = 0;
  for (const field of ['algebraic', 'white']) for (const kind of ['correct', 'invalid']) {
    if (a.state()?.locked) a.press('sdNext');
    a.change('sdAnswerMode', field); a.change('sdPromptMode', field === 'algebraic' ? 'black' : 'algebraic');
    a.press('sdNext'); await a.settle();
    const current = a.state().current, index = a.state().index, values = expected(current), id = 'sd' + suffix(field);
    a.press(colorButton(values.color));
    for (const partial of ['9', values[field].slice(0, -1)]) {
      a.change(id, partial, 'input'); a.enter(a.el(id)); await a.settle();
      assert.equal(a.state().attempts, attempts); assert.equal(a.state().index, index, 'partial typed notation and Enter do not grade');
      assert.equal(a.el('sdFeedback').textContent, 'No answer submitted.');
    }
    const typed = kind === 'invalid' ? field === 'algebraic' ? 'z9' : 'xx9'
      : field === 'algebraic' ? ' ' + values[field].toUpperCase() + ' ' : values[field].toLowerCase().split('').join(' ');
    a.change(id, typed, 'input'); await a.settle();
    assert.equal(a.state().attempts, ++attempts, 'complete typed token grades immediately');
    if (kind === 'correct') {
      assert.equal(a.state().correct, ++correct); assert.equal(a.state().index, index + 1); assert.equal(a.state().locked, false);
      assert.equal(a.el(id).value, '');
    } else {
      assert.equal(a.state().correct, correct); assert.equal(a.state().index, index); assert.equal(a.state().locked, true);
      assertMissedAnswer(a, field, values); assert.equal(a.el(id).value, typed, 'invalid complete input remains visible with its correction');
      a.change(id, typed, 'input'); await a.settle(); assert.equal(a.state().attempts, attempts, 'repeated input cannot regrade a locked answer');
    }
  }
});

test('Windows and Android ship identical shared drill assets', () => {
  for (const name of ['js/modules/square-drills-core.js', 'js/modules/square-drills.js', 'css/app.css', 'css/square-drills.css']) {
    assert.equal(fs.readFileSync(path.join(roots.Windows, name), 'utf8'),
      fs.readFileSync(path.join(roots.Android, name), 'utf8'), name + ' matches across platforms');
  }
});

for (const platform of Object.keys(roots)) {
  test(platform + ': queued saves stay ordered and flush waits for the final snapshot', async t => {
    const a = await open(platform); t.after(() => a.close());
    const api = a.w.ChessTools.api, save = api.saveState.bind(api);
    const pending = [], received = [];
    let active = 0, peak = 0, finished = false;
    api.saveState = async (id, payload) => {
      active += 1; peak = Math.max(peak, active);
      received.push(JSON.parse(JSON.stringify(payload)));
      await new Promise(resolve => pending.push(resolve));
      try { return await save(id, payload); } finally { active -= 1; }
    };
    a.change('sdPromptMode', 'black'); a.press('sdNext');
    a.key('algebraic', 'c'); a.press('sdColorLight');
    const flushed = a.w.ChessTools.flush().then(() => { finished = true; });
    await a.settle();
    assert.equal(received.length, 1); assert.equal(finished, false);
    for (let i = 0; i < 10 && !finished; i++) {
      assert.equal(pending.length, 1, 'one write reaches storage at a time');
      pending.shift()(); await a.settle();
    }
    await flushed;
    assert.equal(peak, 1);
    assert.equal(received.length, 5);
    assert.equal(received[0].current, null);
    assert.equal(received[1].answers.algebraic, '');
    assert.equal(received[2].answers.algebraic, 'c');
    assert.equal(received[3].answers.color, 'white');
    assert.deepEqual(a.state(), received.at(-1));
    assert.equal(a.state().answers.algebraic, 'c');
    assert.equal(a.state().attempts, 0, 'flush does not grade unfinished answers');
  });

  test(platform + ': clear saved waits for prior writes and resets only after deletion', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.press('sdNext'); await a.settle();
    const api = a.w.ChessTools.api, save = api.saveState.bind(api), remove = api.deleteState.bind(api);
    const pending = []; let deleting = false, allowDelete;
    api.saveState = async (id, payload) => {
      await new Promise(resolve => pending.push(resolve));
      return save(id, payload);
    };
    api.deleteState = async id => {
      deleting = true;
      await new Promise(resolve => { allowDelete = resolve; });
      return remove(id);
    };
    a.change('sdAnswerMode', 'custom'); a.press('sdClearSaved'); await a.settle();
    assert.equal(deleting, false, 'delete cannot overtake a queued save');
    assert.equal(pending.length, 1);
    pending.shift()(); await a.settle();
    assert.equal(deleting, true);
    assert.notEqual(a.el('sdPrompt').textContent, 'Ready', 'screen stays intact until deletion succeeds');
    allowDelete(); await a.settle();
    assert.equal(a.state(), undefined);
    assert.equal(a.el('sdPrompt').textContent, 'Ready');
    assert.equal(a.el('sdRemember').checked, true);
    assert.equal(pending.length, 0);
    assert.equal(a.store.calls.at(-1).method, 'DELETE');
  });

  test(platform + ': failed flush rejects, reports the error, and can recover without resetting progress', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.press('sdNext'); await a.settle();
    const previous = structuredClone(a.state());
    const api = a.w.ChessTools.api, save = api.saveState.bind(api);
    api.saveState = async () => { throw new Error('Storage write failed'); };
    await assert.rejects(a.w.ChessTools.flush(), /Storage write failed/);
    assert.match(a.el('notice').textContent, /Storage write failed/);
    assert.deepEqual(a.state(), previous);
    assert.notEqual(a.el('sdPrompt').textContent, 'Ready');
    api.saveState = save;
    a.press('sdColorLight');
    await a.w.ChessTools.flush();
    assert.equal(a.state().current, previous.current);
    assert.equal(a.state().answers.color, 'white');
    assert.equal(a.state().attempts, 0);
  });

  test(platform + ': closing flush cannot overtake an in-flight Clear saved operation', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.press('sdNext'); a.press('sdSubmit'); await a.settle();
    assert.equal(a.state().attempts, 1);
    const api = a.w.ChessTools.api, remove = api.deleteState.bind(api);
    let allowDelete, finished = false;
    api.deleteState = async id => {
      await new Promise(resolve => { allowDelete = resolve; });
      return remove(id);
    };
    a.press('sdClearSaved'); await a.settle();
    const flush = a.w.ChessTools.flush().then(() => { finished = true; });
    await a.settle(); assert.equal(finished, false);
    assert.equal(a.state().attempts, 1);
    allowDelete(); await flush;
    assert.equal(a.state().attempts, 0);
    assert.equal(a.state().current, null);
    assert.equal(a.el('sdPrompt').textContent, 'Ready');
  });

  test(platform + ': flush includes pending theme persistence and preserves paused remembering', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.press('sdNext'); a.check('sdRemember', false); await a.settle();
    const saved = structuredClone(a.state());
    a.press('sdNext');
    const api = a.w.ChessTools.api, request = api.request.bind(api);
    let release, finished = false;
    api.request = async (url, options = {}) => {
      if (url === '/api/settings/theme' && options.method === 'PUT') {
        await new Promise(resolve => { release = resolve; });
      }
      return request(url, options);
    };
    a.press('themeDark');
    const flush = a.w.ChessTools.flush().then(() => { finished = true; });
    await a.settle(); assert.equal(finished, false);
    assert.equal(a.el('themeLight').disabled, true);
    release(); await flush;
    assert.equal(a.store.settings.theme, 'dark');
    assert.deepEqual(a.state(), saved, 'closing never forces a save while Remember is off');
    assert.equal(a.el('themeLight').disabled, false);
  });

  test(platform + ': theme failures prevent a successful flush until a later save recovers', async t => {
    const a = await open(platform); t.after(() => a.close());
    const api = a.w.ChessTools.api, request = api.request.bind(api);
    api.request = async (url, options = {}) => {
      if (url === '/api/settings/theme' && options.method === 'PUT') throw new Error('Theme write failed');
      return request(url, options);
    };
    a.press('themeDark');
    await assert.rejects(a.w.ChessTools.flush(), /Theme write failed/);
    assert.equal(a.d.documentElement.dataset.theme, 'light');
    assert.equal(a.el('themeLight').disabled, false);
    api.request = request;
    await a.w.ChessTools.flush();
    assert.equal(a.d.documentElement.dataset.theme, 'dark');
    assert.equal(a.store.settings.theme, 'dark', 'retrying close saves the originally requested theme without another click');
  });

  test(platform + ': closing during state initialization does not overwrite saved progress with defaults', async t => {
    const store = storage();
    const initial = await open(platform, store);
    initial.press('sdNext'); initial.press('sdSubmit'); await initial.w.ChessTools.flush(); initial.close();
    const before = structuredClone(store.states);
    let releaseLoad;
    const gate = new Promise(resolve => { releaseLoad = resolve; });
    const a = await open(platform, store, {
      waitForReady: false,
      beforeReady({ w }) {
        const load = w.ChessTools.api.loadState.bind(w.ChessTools.api);
        w.ChessTools.api.loadState = async id => { await gate; return load(id); };
      },
    });
    t.after(() => a.close());
    assert.notEqual(a.d.body.dataset.ready, 'true');
    assert.equal(a.el('themeLight').disabled, true);
    assert.equal(a.el('themeDark').disabled, true);
    const writes = store.calls.filter(call => call.method === 'PUT').length;
    a.press('themeDark'); await a.w.ChessTools.flush();
    assert.equal(store.calls.filter(call => call.method === 'PUT').length, writes);
    assert.deepEqual(store.states, before);
    releaseLoad(); await a.settle();
    assert.equal(a.d.body.dataset.ready, 'true');
    assert.equal(a.el('sdAttempts').textContent, '1');
    assert.equal(a.el('themeLight').disabled, false);
    await a.w.ChessTools.flush(); assert.deepEqual(store.states, before);
  });

  test(platform + ': retrying a failed Remember-off write saves only the snapshot from before remembering paused', async t => {
    const a = await open(platform); t.after(() => a.close());
    a.press('sdNext'); await a.w.ChessTools.flush();
    const before = structuredClone(a.state());
    const api = a.w.ChessTools.api, save = api.saveState.bind(api);
    const failed = [];
    api.saveState = async (id, payload) => {
      failed.push(JSON.parse(JSON.stringify(payload)));
      throw new Error('Final snapshot write failed');
    };
    a.check('sdRemember', false); await a.settle();
    assert.equal(failed.length, 1);
    assert.equal(failed[0].remember, false);
    a.press('sdNext'); a.press('sdColorLight'); await a.settle();
    assert.equal(failed.length, 1, 'later answers do not enqueue saves');
    await assert.rejects(a.w.ChessTools.flush(), /Final snapshot write failed/);
    assert.equal(failed.length, 2);
    assert.deepEqual(failed[1], failed[0], 'retry uses the exact original snapshot');
    assert.deepEqual(a.state(), before);
    api.saveState = save;
    await a.w.ChessTools.flush();
    assert.deepEqual(a.state(), failed[0]);
    assert.equal(a.state().current, before.current);
    assert.equal(a.state().answers.color, '');
    assert.equal(a.el('sdColor').value, 'white', 'unsaved current work remains on screen');
  });

  test(platform + ': separate standalone storage does not change another application snapshot', async t => {
    const existing = storage(), standalone = storage();
    existing.states['square-drills'] = { attempts: 17, correct: 12, answers: { color: 'black' } };
    existing.settings.theme = 'dark';
    const before = structuredClone(existing);
    const a = await open(platform, standalone); t.after(() => a.close());
    a.press('sdNext'); a.press('themeDark'); await a.w.ChessTools.flush();
    assert.equal(a.state().attempts, 0);
    assert.deepEqual(existing, before);
    assert.notEqual(standalone.states, existing.states);
  });
}

test('shared theme tokens use the approved light and charcoal palettes', () => {
  const css = fs.readFileSync(path.join(roots.Windows, 'css/app.css'), 'utf8');
  const light = css.slice(0, css.indexOf(':root[data-theme="dark"]'));
  const dark = css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf('* {'));
  const expected = {
    light: { bg: '#F2F2F2', surface: '#FFFFFF', control: '#FFFFFF', text: '#171717', muted: '#484848',
      border: '#858585', hover: '#E6E6E6', focus: '#005FCC', 'disabled-text': '#696969',
      'disabled-bg': '#E6E6E6', 'disabled-border': '#B8B8B8', danger: '#A51B1B' },
    dark: { bg: '#202020', surface: '#2A2A2A', control: '#353535', text: '#F5F5F5', muted: '#D2D2D2',
      border: '#858585', hover: '#424242', focus: '#75BAFF', 'disabled-text': '#A3A3A3',
      'disabled-bg': '#262626', 'disabled-border': '#555555', danger: '#FFB7B7' },
  };
  for (const [mode, section] of Object.entries({ light, dark })) {
    for (const [token, value] of Object.entries(expected[mode])) {
      assert.match(section, new RegExp(`--${token}: ${value};`, 'i'));
    }
  }
  assert.match(light, /--accent: #007BFF;/);
  assert.doesNotMatch(dark, /--accent:/, 'both themes inherit the same primary accent');
  for (const platform of Object.keys(roots)) {
    const style = fs.readFileSync(path.join(roots[platform], 'css/square-drills.css'), 'utf8');
    assert.match(style, /outline: 2px solid var\(--focus\)/);
    assert.match(style, /background: var\(--disabled-bg\)/);
    assert.match(style, /button\[aria-pressed="true"\]:disabled \{ box-shadow: inset 0 -3px 0 var\(--accent\)/,
      'locked selected color and keypad buttons remain visibly marked');
    assert.doesNotMatch(style, /opacity: \.5/);
  }
});
