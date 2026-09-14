/* ══════════════ THE PET — a draggable companion that shows today's schedule ══════════════
   No chat, no backend. Click it and it tells you what's on today, pulled straight
   from the Calendar module's own data. Drag it anywhere; position is remembered.
   ================================================================== */
const Pet = (() => {

  /* ---------------- pose vocabulary ---------------- */
  const MASTER_POSES = [
    { k: 'idle',      label: 'Idle',            hint: 'Default — standing, hands clasped' },
    { k: 'greet',     label: 'Greeting',        hint: 'First open of the day' },
    { k: 'thinking',  label: 'Thinking',        hint: 'Reading your schedule' },
    { k: 'talking',   label: 'Talking',         hint: 'Showing today\u2019s schedule' },
    { k: 'listening', label: 'Listening',       hint: 'Reserved for later use' },
    { k: 'success',   label: 'Success',         hint: 'Nothing left on today\u2019s list' },
    { k: 'alert',     label: 'Alert',           hint: 'Something\u2019s overdue today' },
    { k: 'error',     label: 'Error',           hint: 'Something failed' },
    { k: 'hover',     label: 'Hover',           hint: 'Cursor resting on it' },
    { k: 'sleep',     label: 'Sleeping',        hint: 'No activity for a while' },
    { k: 'celebrate', label: 'Celebrating',     hint: 'Big win or streak' },
    { k: 'wave',      label: 'Waving goodbye',  hint: 'Popover closing' },
    { k: 'typing',    label: 'Typing',          hint: 'Reserved for later use' },
    { k: 'reading',   label: 'Reading',         hint: 'Reserved for later use' },
    { k: 'searching', label: 'Searching',       hint: 'Reserved for later use' },
    { k: 'pointing',  label: 'Pointing',        hint: 'Directing you to a panel' },
    { k: 'confused',  label: 'Confused',        hint: 'Couldn\u2019t find anything today' },
    { k: 'waiting',   label: 'Waiting',         hint: 'Reserved for later use' },
    { k: 'sitting',   label: 'Relaxed',         hint: 'Long idle, settled in' },
    { k: 'walking',   label: 'Busy',            hint: 'Reserved for later use' }
  ];
  const MASTER_KEYS = MASTER_POSES.map(p => p.k);
  const DEFAULT_ACTIVE = ['idle', 'greet', 'thinking', 'talking', 'success', 'alert', 'error', 'sleep', 'celebrate'];
  const MIN_ACTIVE = 9, MAX_ACTIVE = 12;
  const IMG_PREFIX = 'pet:pose:';

  const D = {
    cfg: Store.get('pet.cfg', { name: 'Pet', enabled: true }),
    pos: Store.get('pet.pos', null),          // {x,y} in px from top-left, null = use default corner
    active: Store.get('pet.activePoses', DEFAULT_ACTIVE)
  };
  function activePoses() { return MASTER_POSES.filter(p => D.active.includes(p.k)); }
  function save() { Store.set('pet.cfg', D.cfg); }
  function savePos() { Store.set('pet.pos', D.pos); }

  let state = 'idle';
  let sleepTimer = null;
  const imgCache = {};

  /* ---------------- image plumbing (same pipeline as Gallery/Profile) ---------------- */
  async function loadImg(k) {
    if (k in imgCache) return imgCache[k];
    const d = await Store.getImg(IMG_PREFIX + k);
    imgCache[k] = d || null;
    return imgCache[k];
  }
  async function setImg(k, dataUrl) { await Store.putImg(IMG_PREFIX + k, dataUrl); imgCache[k] = dataUrl; }
  async function clearImg(k) { await Store.delImg(IMG_PREFIX + k); imgCache[k] = null; }
  async function resolve(k) { return (await loadImg(k)) || (await loadImg('idle')) || null; }

  /* ---------------- built-in placeholder figure ----------------
     Proportioned croquis rig — real shoulder/elbow/wrist joints solved
     with 2-bone IK, not a blob. Nine poses are hand-tuned; the rest of
     the 20-pose vocabulary borrows the closest of those nine. */
  const RIG = {"w":130,"h":190,"headR":13,"neck":[60,34],"shL":[38,45],"shR":[78,45],
    "hipL":[50,98],"hipR":[72,98],"kneeL":[48,148],"kneeR":[74,148],"ankL":[46,186],"ankR":[76,186],
    "poses":{
      "idle":{"head":[60,20],"elbowR":[85.71,78.11],"wristR":[56,90],"elbowL":[34.04,78.77],"wristL":[64,90]},
      "greet":{"head":[60,20],"elbowR":[111.98,43.73],"wristR":[96,16],"elbowL":[24.82,76.34],"wristL":[34,107]},
      "thinking":{"head":[60,20],"elbowR":[82.56,11.31],"wristR":[60,34],"elbowL":[24.82,76.34],"wristL":[34,107]},
      "talking":{"head":[60,20],"elbowR":[110.99,36.77],"wristR":[104,68],"elbowL":[4.88,37.33],"wristL":[14,68]},
      "listening":{"head":[60,20],"elbowR":[108.64,30.27],"wristR":[80,16],"elbowL":[24.82,76.34],"wristL":[34,107]},
      "success":{"head":[60,20],"elbowR":[111.27,37.97],"wristR":[88,16],"elbowL":[5.73,34.28],"wristL":[32,16]},
      "alert":{"head":[60,20],"elbowR":[102.37,21.29],"wristR":[120,48],"elbowL":[24.82,76.34],"wristL":[34,107]},
      "error":{"head":[60,20],"elbowR":[111.96,46.56],"wristR":[106,78],"elbowL":[4.1,47.57],"wristL":[14,78]},
      "sleep":{"head":[70,28],"elbowR":[103.85,22.92],"wristR":[72,26],"elbowL":[24.82,76.34],"wristL":[34,107]}
    }};
  const RIG_ALIAS = { hover:'idle', wave:'greet', celebrate:'success', confused:'error',
    waiting:'idle', sitting:'idle', walking:'talking', pointing:'alert', reading:'thinking', searching:'thinking', typing:'talking' };
  function rigPoseFor(key) { return RIG.poses[key] || RIG.poses[RIG_ALIAS[key]] || RIG.poses.idle; }

  /* full=true renders the whole figure head-to-foot (used everywhere the
     pet actually appears now — no cropping, since there's no small avatar
     bubble anymore) */
  function blankFigureSVG(poseKey, full) {
    const p = rigPoseFor(poseKey);
    const vb = full ? `0 0 ${RIG.w} ${RIG.h}` : `0 0 ${RIG.w} 132`;
    const cap = (p1, p2, w) => `<line x1="${p1[0]}" y1="${p1[1]}" x2="${p2[0]}" y2="${p2[1]}" stroke="var(--faint)" stroke-width="${w}" stroke-linecap="round"/>`;
    const dot = (c, r) => `<circle cx="${c[0]}" cy="${c[1]}" r="${r}" fill="var(--faint)"/>`;
    const legs = full ? `
      ${cap(RIG.hipL, RIG.kneeL, 15)}${cap(RIG.kneeL, RIG.ankL, 13)}
      ${cap(RIG.hipR, RIG.kneeR, 15)}${cap(RIG.kneeR, RIG.ankR, 13)}
      <ellipse cx="${RIG.ankL[0]}" cy="${RIG.ankL[1]+1}" rx="9" ry="6" fill="var(--faint)"/>
      <ellipse cx="${RIG.ankR[0]}" cy="${RIG.ankR[1]+1}" rx="9" ry="6" fill="var(--faint)"/>` : '';
    return `<svg viewBox="${vb}" width="100%" height="100%" preserveAspectRatio="xMidYMax meet">
      ${legs}
      <polygon points="${RIG.shL},${RIG.shR},${RIG.hipR},${RIG.hipL}" fill="var(--faint)"/>
      ${cap(RIG.neck, [p.head[0], p.head[1]+9], 12)}
      ${cap(RIG.shL, p.elbowL, 13)}${cap(p.elbowL, p.wristL, 11)}
      ${cap(RIG.shR, p.elbowR, 13)}${cap(p.elbowR, p.wristR, 11)}
      ${dot(p.wristL, 7)}${dot(p.wristR, 7)}
      ${dot(p.head, RIG.headR)}
    </svg>`;
  }

  /* ---------------- the pet element itself ---------------- */
  function mountWidget() {
    if (document.getElementById('petDock')) return;
    const dock = el('div', 'pet-dock');
    dock.id = 'petDock';
    dock.innerHTML = `<div class="pet-figure" id="petFigure"></div>`;
    document.body.appendChild(dock);
    placeAtSavedOrDefault(dock);
    wireDrag(dock);
    render();
    armSleepTimer();
    ['mousemove', 'keydown', 'click'].forEach(ev =>
      document.addEventListener(ev, armSleepTimer, { passive: true }));
    window.addEventListener('resize', () => clampIntoView(dock));
  }

  function placeAtSavedOrDefault(dock) {
    if (D.pos) {
      dock.style.left = D.pos.x + 'px';
      dock.style.top = D.pos.y + 'px';
    } else {
      dock.style.right = '24px';
      dock.style.bottom = '24px';
    }
  }
  function clampIntoView(dock) {
    const r = dock.getBoundingClientRect();
    let x = r.left, y = r.top;
    x = Math.min(Math.max(0, x), window.innerWidth - r.width);
    y = Math.min(Math.max(0, y), window.innerHeight - r.height);
    dock.style.left = x + 'px'; dock.style.top = y + 'px';
    dock.style.right = ''; dock.style.bottom = '';
  }

  function wireDrag(dock) {
    let startX, startY, origX, origY, dragging = false, moved = false;
    dock.addEventListener('pointerdown', e => {
      const r = dock.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY; origX = r.left; origY = r.top;
      dragging = true; moved = false;
      dock.setPointerCapture(e.pointerId);
      dock.classList.add('dragging');
    });
    dock.addEventListener('pointermove', e => {
      if (!dragging) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      if (!moved) return;
      dock.style.left = (origX + dx) + 'px';
      dock.style.top = (origY + dy) + 'px';
      dock.style.right = ''; dock.style.bottom = '';
      closePopover();
    });
    dock.addEventListener('pointerup', e => {
      dragging = false;
      dock.classList.remove('dragging');
      if (moved) {
        clampIntoView(dock);
        const r = dock.getBoundingClientRect();
        D.pos = { x: Math.round(r.left), y: Math.round(r.top) };
        savePos();
      } else {
        togglePopover();
      }
    });
  }

  function resetPosition() {
    D.pos = null; savePos();
    const dock = document.getElementById('petDock');
    if (dock) placeAtSavedOrDefault(dock);
  }

  /* ---------------- click behaviour: show today's schedule ---------------- */
  let popoverOpen = false;
  function togglePopover() { popoverOpen ? closePopover() : openPopover(); }
  function closePopover() {
    popoverOpen = false;
    const pop = document.getElementById('petPopover');
    if (pop) pop.remove();
    setState('idle');
  }
  function openPopover() {
    popoverOpen = true;
    const items = (typeof Cal !== 'undefined' && Cal.todayItems) ? Cal.todayItems() : [];
    const overdue = items.some(i => i.kind === 'task' && !i.done);
    setState(items.length === 0 ? 'success' : (overdue ? 'alert' : 'talking'));

    const dock = document.getElementById('petDock');
    const pop = el('div', 'pet-popover');
    pop.id = 'petPopover';
    const dateStr = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    pop.innerHTML = `
      <div class="pet-pop-head">
        <p class="pet-pop-date">${esc(dateStr)}</p>
        <button class="pet-pop-close" aria-label="Close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="pet-pop-body">
        ${items.length === 0
          ? '<p class="pet-pop-empty">Nothing on the calendar for today.</p>'
          : items.map(i => `
            <div class="pet-pop-item${i.done ? ' done' : ''}">
              <span class="pet-pop-dot" style="background:${i.color}"></span>
              <span>${esc(i.text)}</span>
            </div>`).join('')}
      </div>
      <button class="link-btn pet-pop-open">Open calendar</button>`;
    dock.appendChild(pop);
    positionPopover(dock, pop);
    pop.querySelector('.pet-pop-close').addEventListener('click', closePopover);
    pop.querySelector('.pet-pop-open').addEventListener('click', () => {
      closePopover();
      const nav = document.querySelector('.nav-item[data-view="calendar"]');
      if (nav) nav.click();
    });
  }
  function positionPopover(dock, pop) {
    const r = dock.getBoundingClientRect();
    const openLeft = r.left > window.innerWidth / 2;
    pop.style.bottom = (window.innerHeight - r.top) + 'px';
    if (openLeft) { pop.style.right = (window.innerWidth - r.right) + 'px'; }
    else { pop.style.left = r.left + 'px'; }
  }

  /* ---------------- state / pose rendering ---------------- */
  async function setState(k) {
    if (!MASTER_KEYS.includes(k)) return;
    state = k;
    await paint();
  }
  async function paint() {
    const node = document.getElementById('petFigure');
    if (!node) return;
    const src = await resolve(state);
    if (src) {
      node.style.backgroundImage = `url("${src}")`;
      node.classList.remove('blank');
      node.innerHTML = '';
    } else {
      node.style.backgroundImage = '';
      node.classList.add('blank');
      node.innerHTML = blankFigureSVG(state, true);
    }
    const dock = document.getElementById('petDock');
    if (dock) dock.classList.toggle('bob-paused', state !== 'idle');
  }
  function armSleepTimer() {
    clearTimeout(sleepTimer);
    if (state === 'sleep') setState('idle');
    sleepTimer = setTimeout(() => { if (!popoverOpen) setState('sleep'); }, 5 * 60 * 1000);
  }

  function render() {
    const dock = document.getElementById('petDock');
    if (dock) dock.title = D.cfg.name;
    paint();
  }

  /* ---------------- settings: "edit pet" ---------------- */
  async function renderSettings(container) {
    container.innerHTML = `
      <div class="asst-set-row">
        <label class="asst-set-label">Name</label>
        <input class="inp" id="petNameInp" value="${esc(D.cfg.name)}" placeholder="Pet">
      </div>
      <div class="asst-set-row">
        <label class="asst-set-label">Position</label>
        <button class="btn ghost" id="petResetPos">Reset to bottom right</button>
      </div>

      <p class="asst-set-hint">Choose ${MIN_ACTIVE}-${MAX_ACTIVE} poses (<span id="petPickCount">${D.active.length}</span> selected).
        Idle is always on \u2014 it's the fallback for every pose you don't pick or don't upload.</p>
      <div class="asst-pose-picker" id="petPosePicker"></div>

      <p class="asst-set-hint">Upload an image for each pose you picked above.
        <a href="assets/pose-templates/pose-template-sheet.png" download class="link-btn">Download the pose template sheet</a>
        first \u2014 it shows the exact silhouette and proportions for each pose. Draw or paste your
        character onto each one (transparent background), then upload the result here \u2014
        only the character will show, not the sheet's guide grid.</p>
      <div class="asst-pose-grid" id="petPoseGrid"></div>`;

    document.getElementById('petNameInp').addEventListener('change', e => {
      D.cfg.name = e.target.value.trim() || 'Pet'; save(); render();
    });
    document.getElementById('petResetPos').addEventListener('click', resetPosition);

    const picker = document.getElementById('petPosePicker');
    MASTER_POSES.forEach(p => {
      const chip = el('label', 'asst-pose-chip' + (D.active.includes(p.k) ? ' on' : '') + (p.k === 'idle' ? ' locked' : ''));
      chip.innerHTML = `<input type="checkbox" ${D.active.includes(p.k) ? 'checked' : ''} ${p.k === 'idle' ? 'disabled' : ''}><span>${esc(p.label)}</span>`;
      if (p.k !== 'idle') {
        chip.querySelector('input').addEventListener('change', e => {
          if (e.target.checked) {
            if (D.active.length >= MAX_ACTIVE) { e.target.checked = false; toast(`Pick at most ${MAX_ACTIVE} poses`); return; }
            D.active.push(p.k);
          } else {
            if (D.active.length <= MIN_ACTIVE) { e.target.checked = true; toast(`Pick at least ${MIN_ACTIVE} poses`); return; }
            D.active = D.active.filter(k => k !== p.k);
          }
          Store.set('pet.activePoses', D.active);
          document.getElementById('petPickCount').textContent = D.active.length;
          chip.classList.toggle('on', e.target.checked);
          renderPoseGrid();
        });
      }
      picker.appendChild(chip);
    });

    await renderPoseGrid();

    async function renderPoseGrid() {
      const grid = document.getElementById('petPoseGrid');
      grid.innerHTML = '';
      for (const p of activePoses()) {
        const cell = el('div', 'asst-pose-cell');
        const img = await loadImg(p.k);
        cell.innerHTML = `
          <div class="asst-pose-thumb ${img ? '' : 'blank'}" style="${img ? `background-image:url('${img}')` : ''}">${img ? '' : blankFigureSVG(p.k, true)}</div>
          <p class="asst-pose-name">${esc(p.label)}</p>
          <p class="asst-pose-hint">${esc(p.hint)}</p>
          <div class="asst-pose-actions">
            <label class="file-btn">Upload<input type="file" accept="image/*" hidden></label>
            ${img ? '<button class="link-btn asst-pose-clear">Remove</button>' : ''}
          </div>`;
        cell.querySelector('input[type=file]').addEventListener('change', async e => {
          const f = e.target.files[0]; if (!f) return;
          const dataUrl = await fileToDataUrl(f);
          await setImg(p.k, dataUrl);
          toast(`${p.label} pose saved`);
          renderPoseGrid();
          paint();
        });
        const clearBtn = cell.querySelector('.asst-pose-clear');
        if (clearBtn) clearBtn.addEventListener('click', async () => {
          await clearImg(p.k); toast(`${p.label} pose removed`); renderPoseGrid(); paint();
        });
        grid.appendChild(cell);
      }
    }
  }
  function fileToDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  function init() {
    if (!D.cfg.enabled) return;
    mountWidget();
  }

  return { init, renderSettings, MASTER_POSES };
})();
