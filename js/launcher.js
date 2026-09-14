/* ══════════════ THE LAUNCHER — blank HUD boot screen ══════════════
   Shown first on every login. A slim status strip up top, then a free
   canvas where every section of the app is a small HUD node the user
   can drag anywhere (Tony Stark style) or just click to open that
   section full-screen. Node positions are saved as fractions of the
   canvas size (not pixels), so the layout survives window resizes and
   different screens.

   Nodes are plain `.nav-item[data-view]` elements — the same thing
   the sidebar uses — so a click on one is caught by app.js's existing
   document-level router with zero extra wiring. This file only adds
   the drag behaviour and tells a click-vs-drag apart. */
const Launcher = (() => {

  const POS_KEY = 'launcher.positions';
  const TILE_R = 46;   // half the tile's rendered width — keeps nodes fully on-canvas

  const WIDGETS = [
    { view: 'dashboard', label: 'Dashboard', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></svg>' },
    { view: 'profile', label: 'Profile', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 3.5-7.5 8-7.5s8 3 8 7.5"/></svg>' },
    { view: 'web', label: 'Web', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="7"/><line x1="5" y1="12" x2="19" y2="12"/><line x1="12" y1="5" x2="12" y2="19"/><line x1="7" y1="7" x2="17" y2="17"/></svg>' },
    { view: 'books', label: 'Shelf', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="3" height="16" rx="0.5"/><rect x="9" y="6" width="3" height="14" rx="0.5"/><rect x="14" y="3" width="3" height="17" rx="0.5"/><rect x="19" y="7" width="1.6" height="13" rx="0.5"/></svg>' },
    { view: 'stacks', label: 'Stacks', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="15" width="16" height="4" rx="1"/><rect x="5.5" y="10" width="13" height="4" rx="1"/><rect x="7" y="5" width="10" height="4" rx="1"/></svg>' },
    { view: 'calendar', label: 'Calendar', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="5" width="17" height="15" rx="2"/><line x1="3.5" y1="10" x2="20.5" y2="10"/><line x1="8" y1="3" x2="8" y2="6.5"/><line x1="16" y1="3" x2="16" y2="6.5"/></svg>' },
    { view: 'thoughts', label: 'Margin', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><line x1="5" y1="7" x2="19" y2="7"/><line x1="5" y1="12" x2="16" y2="12"/><line x1="5" y1="17" x2="12" y2="17"/></svg>' },
    { view: 'docket', label: 'Docket', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9.5 16.2l1.5 1.5 3-3" stroke-linecap="round" stroke-linejoin="round"/></svg>' },
  ];

  function greetingWord() {
    const h = new Date().getHours();
    if (h < 5) return 'Still up';
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    if (h < 21) return 'Good evening';
    return 'Good night';
  }

  function renderTopbar() {
    const name = (Store.get('profile', null) || {}).name;
    const hello = document.getElementById('lnHello');
    if (hello) hello.textContent = `${greetingWord()}${name && name !== 'Your name' ? ', ' + name.split(' ')[0] : ''}.`;

    const dateEl = document.getElementById('lnDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

    const sub = document.getElementById('lnSub');
    if (sub) {
      try {
        const today = typeof iso === 'function' ? iso(new Date()) : new Date().toISOString().slice(0, 10);
        const open = typeof Cal !== 'undefined' ? Cal.dashTasks().filter(t => !t.done && t.date === today).length : 0;
        sub.textContent = open ? `${open} task${open === 1 ? '' : 's'} on deck today.` : 'Nothing pinned for today — clean slate.';
      } catch (e) { sub.textContent = 'Arrange your desk however you like.'; }
    }
  }

  function loadPositions() { return Store.get(POS_KEY, {}); }
  function savePositions(p) { Store.set(POS_KEY, p); }

  function defaultFrac(i, n) {
    // A ring, first node at the top, going clockwise — a repulsor menu.
    const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
    const r = 0.34;
    return { x: 0.5 + r * Math.cos(angle) * 0.82, y: 0.5 + r * Math.sin(angle) };
  }

  function wireDrag(tile, canvas, view) {
    let sx = 0, sy = 0, ox = 0, oy = 0, active = false, dragged = false;

    tile.addEventListener('pointerdown', e => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      active = true; dragged = false;
      sx = e.clientX; sy = e.clientY;
      ox = parseFloat(tile.style.left) || 0;
      oy = parseFloat(tile.style.top) || 0;
      try { tile.setPointerCapture(e.pointerId); } catch (err) { }
    });

    tile.addEventListener('pointermove', e => {
      if (!active) return;
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (!dragged && Math.hypot(dx, dy) > 5) { dragged = true; tile.classList.add('dragging'); }
      if (!dragged) return;
      const rect = canvas.getBoundingClientRect();
      const nx = Math.max(TILE_R, Math.min(rect.width - TILE_R, ox + dx));
      const ny = Math.max(TILE_R, Math.min(rect.height - TILE_R, oy + dy));
      tile.style.left = nx + 'px';
      tile.style.top = ny + 'px';
    });

    tile.addEventListener('pointerup', () => {
      active = false;
      tile.classList.remove('dragging');
      if (!dragged) return;
      const rect = canvas.getBoundingClientRect();
      const positions = loadPositions();
      positions[view] = {
        x: (parseFloat(tile.style.left) || 0) / rect.width,
        y: (parseFloat(tile.style.top) || 0) / rect.height,
      };
      savePositions(positions);
    });

    // A click that followed a real drag shouldn't also open the tab —
    // stopping it here (bubble phase, before app.js's document listener
    // sees it) is enough; a plain click falls through and navigates.
    tile.addEventListener('click', e => {
      if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; }
    });
  }

  function render() {
    renderTopbar();
    const canvas = document.getElementById('launcherCanvas');
    const host = document.getElementById('launcherTiles');
    if (!canvas || !host) return;

    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 900, h = rect.height || 460;
    const positions = loadPositions();

    host.innerHTML = '';
    WIDGETS.forEach((wd, i) => {
      const frac = positions[wd.view] || defaultFrac(i, WIDGETS.length);
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'nav-item launcher-tile';
      tile.dataset.view = wd.view;
      tile.draggable = false;
      tile.title = `Open ${wd.label}`;
      tile.innerHTML = `<span class="lt-ring"></span><span class="lt-icon">${wd.icon}</span><span class="lt-label">${wd.label}</span>`;
      tile.style.left = Math.max(TILE_R, Math.min(w - TILE_R, frac.x * w)) + 'px';
      tile.style.top = Math.max(TILE_R, Math.min(h - TILE_R, frac.y * h)) + 'px';
      wireDrag(tile, canvas, wd.view);
      host.appendChild(tile);
    });
  }

  function resetLayout() {
    savePositions({});
    render();
  }

  let resizeBound = false;
  function init() {
    const btn = document.getElementById('launcherReset');
    if (btn) btn.onclick = resetLayout;
    if (!resizeBound) {
      resizeBound = true;
      window.addEventListener('resize', () => {
        const v = document.getElementById('view-launcher');
        if (v && v.classList.contains('on')) render();
      });
    }
    render();
  }

  return { init, render };
})();
