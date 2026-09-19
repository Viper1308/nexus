/* ══════════════════════════════════════════════════════════════════════
   THE VAULT — a private, encrypted twin of the Margin.

   Reached only by clicking the decoy spine at the end of the "Want to
   read" shelf, then entering the passphrase. Notes live under a bland
   Store key and are AES-GCM encrypted with a key derived from the
   passphrase (PBKDF2-SHA256). The passphrase is never written anywhere:
   it exists as a CryptoKey in memory for as long as the vault is open,
   and is thrown away the moment it locks.

   What that buys you: anyone who opens devtools, reads localStorage,
   opens a backup file, or reads the Supabase row sees ciphertext only.
   What it does not buy you: this is client-side code, so the existence
   of the feature is visible to anyone who reads the page source. The
   secret being protected here is the contents, not the door.
   ══════════════════════════════════════════════════════════════════════ */
const Vault = (() => {

  /* ── things worth changing ─────────────────────────────────────── */
  const DECOY = { title: 'The Book of Disquiet', author: 'Fernando Pessoa' };
  const KEY = 'kasi.idx';        // where the ciphertext lives in Store
  const IMG = 'ix:';             // prefix for encrypted pictures
  const ITER = 600000;           // PBKDF2 rounds (OWASP's current figure)
  const IDLE_MS = 5 * 60 * 1000; // lock after this long with no activity
  const HIDDEN_MS = 45 * 1000;   // lock this long after the tab goes away

  /* ── session state (memory only, never persisted) ──────────────── */
  let ckey = null;      // CryptoKey
  let salt = null;      // Uint8Array
  let list = [];        // decrypted notes
  let isOpen = false;
  let kind = 'thought', q = '', pendingImg = null;
  let idleTimer = null, hiddenTimer = null, fails = 0;
  let wired = false;

  /* ══════════════ crypto ══════════════ */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const B64HEAD = 'data:application/octet-stream;base64,';

  function b64(buf) {
    const a = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function unb64(s) {
    const bin = atob(s), a = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
    return a;
  }
  const canCrypt = () => !!(window.crypto && crypto.subtle && crypto.getRandomValues);

  async function derive(pass, saltBytes) {
    const base = await crypto.subtle.importKey('raw', enc.encode(pass), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt: saltBytes, iterations: ITER, hash: 'SHA-256' },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
    );
  }
  async function seal(text, k) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k || ckey, enc.encode(text));
    return { i: b64(iv), d: b64(ct) };
  }
  async function unseal(envelope, k) {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(envelope.i) }, k || ckey, unb64(envelope.d));
    return dec.decode(pt);
  }

  /* Pictures are sealed into a real data: URL so that Store/Sync can
     move them around exactly like any other image. Layout: 12-byte IV
     followed by the ciphertext. */
  async function sealImg(dataUrl, k) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k || ckey, enc.encode(dataUrl)));
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0); out.set(ct, iv.length);
    return B64HEAD + b64(out);
  }
  async function unsealImg(packed, k) {
    if (!packed || packed.indexOf('base64,') < 0) return null;
    const raw = unb64(packed.slice(packed.indexOf('base64,') + 7));
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: raw.slice(0, 12) }, k || ckey, raw.slice(12));
    return dec.decode(pt);
  }

  /* ══════════════ persistence ══════════════ */
  const stored = () => Store.get(KEY, null);
  const provisioned = () => { const b = stored(); return !!(b && b.s && b.d); };

  async function persist() {
    if (!ckey) return;
    const e = await seal(JSON.stringify(list));
    Store.set(KEY, { v: 1, s: b64(salt), i: e.i, d: e.d });
  }

  async function tryOpen(pass) {
    const b = stored();
    if (!b) return false;
    const k = await derive(pass, unb64(b.s));
    let parsed;
    try { parsed = JSON.parse(await unseal(b, k)); }
    catch (e) { return false; }          // bad passphrase: GCM tag won't verify
    if (!Array.isArray(parsed)) return false;
    ckey = k; salt = unb64(b.s); list = parsed;
    return true;
  }

  async function provision(pass) {
    salt = crypto.getRandomValues(new Uint8Array(16));
    ckey = await derive(pass, salt);
    list = [];
    await persist();
  }

  async function putImage(id, dataUrl) { await Store.putImg(IMG + id, await sealImg(dataUrl)); }
  async function getImage(id) {
    const raw = await Store.getImg(IMG + id);
    if (!raw) return null;
    try { return await unsealImg(raw); } catch (e) { return null; }
  }

  /* ══════════════ the decoy on the shelf ══════════════ */
  const PALETTE = ['#7a2e2e', '#2f4a6d', '#3d5a3a', '#6b4a1f', '#4a2f5e', '#1f4f52', '#7d5320', '#503a2c', '#2b3a55', '#5e2a44'];
  const hash = s => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  function decoy() {
    const spine = PALETTE[hash(DECOY.title + DECOY.author) % PALETTE.length];
    const n = parseInt(spine.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    return { ...DECOY, spine, text: (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? '#1a1610' : '#f3efe6' };
  }

  /* ══════════════ the gate ══════════════ */
  function closeGate() {
    const g = document.getElementById('vaultGate');
    if (g) g.remove();
  }

  function knock() {
    if (document.getElementById('vaultGate')) return;
    const setup = !provisioned();

    const gate = el('div', 'vault-gate'); gate.id = 'vaultGate';
    const card = el('div', 'vault-gate-card');
    const d = decoy();
    card.innerHTML = `
      <div class="vault-gate-spine" style="background:linear-gradient(155deg,${d.spine},#00000066)"></div>
      <div class="vault-gate-body">
        <div class="vault-gate-ttl">${esc(d.title)}</div>
        <div class="vault-gate-aut">${esc(d.author)}</div>
        <input type="password" class="inp" id="vgPass" autocomplete="off"
               placeholder="${setup ? 'Choose a passphrase' : 'Passphrase'}">
        ${setup ? '<input type="password" class="inp" id="vgPass2" autocomplete="off" placeholder="Type it again">' : ''}
        <button class="btn" id="vgGo">${setup ? 'Set passphrase' : 'Open'}</button>
        <p class="vault-gate-err" id="vgErr">${setup
        ? 'Nothing is stored but the encrypted notes themselves. Lose this and the notes are gone for good.'
        : ''}</p>
      </div>`;
    gate.appendChild(card);
    gate.onclick = e => { if (e.target === gate) closeGate(); };
    document.body.appendChild(gate);

    const pass = document.getElementById('vgPass');
    const pass2 = document.getElementById('vgPass2');
    const err = document.getElementById('vgErr');
    const go = document.getElementById('vgGo');
    setTimeout(() => pass.focus(), 30);

    const fail = msg => { err.textContent = msg; err.classList.add('bad'); pass.value = ''; if (pass2) pass2.value = ''; pass.focus(); };

    async function submit() {
      if (!canCrypt()) return fail('This browser will not do encryption here. Open the site over https.');
      const p = pass.value;
      if (!p) return;
      go.disabled = true; go.textContent = 'Working…';
      try {
        if (setup) {
          if (p.length < 8) { go.disabled = false; go.textContent = 'Set passphrase'; return fail('Make it at least 8 characters.'); }
          if (p !== pass2.value) { go.disabled = false; go.textContent = 'Set passphrase'; return fail('Those two do not match.'); }
          await provision(p);
          closeGate(); enter();
        } else {
          if (fails) await new Promise(r => setTimeout(r, Math.min(fails * 800, 8000)));
          const ok = await tryOpen(p);
          if (!ok) { fails++; go.disabled = false; go.textContent = 'Open'; return fail('That is not it.'); }
          fails = 0;
          closeGate(); enter();
        }
      } catch (e) {
        go.disabled = false; go.textContent = setup ? 'Set passphrase' : 'Open';
        fail('Could not unlock. ' + (e.message || ''));
      }
    }
    go.onclick = submit;
    [pass, pass2].forEach(i => i && i.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i === pass && pass2) pass2.focus(); else submit();
    }));
  }

  /* ══════════════ change the passphrase ══════════════ */
  function changePass() {
    if (!isOpen) return;
    if (document.getElementById('vaultGate')) return;
    const gate = el('div', 'vault-gate'); gate.id = 'vaultGate';
    const card = el('div', 'vault-gate-card solo');
    card.innerHTML = `
      <div class="vault-gate-body">
        <div class="vault-gate-ttl">New passphrase</div>
        <div class="vault-gate-aut">Everything in here is re-encrypted.</div>
        <input type="password" class="inp" id="vgPass" autocomplete="off" placeholder="New passphrase">
        <input type="password" class="inp" id="vgPass2" autocomplete="off" placeholder="Type it again">
        <button class="btn" id="vgGo">Change it</button>
        <p class="vault-gate-err" id="vgErr"></p>
      </div>`;
    gate.appendChild(card);
    gate.onclick = e => { if (e.target === gate) closeGate(); };
    document.body.appendChild(gate);
    const p1 = document.getElementById('vgPass'), p2 = document.getElementById('vgPass2');
    const err = document.getElementById('vgErr'), go = document.getElementById('vgGo');
    setTimeout(() => p1.focus(), 30);
    go.onclick = async () => {
      if (p1.value.length < 8) { err.textContent = 'At least 8 characters.'; err.classList.add('bad'); return; }
      if (p1.value !== p2.value) { err.textContent = 'Those two do not match.'; err.classList.add('bad'); return; }
      go.disabled = true; go.textContent = 'Re-encrypting…';
      try {
        const newSalt = crypto.getRandomValues(new Uint8Array(16));
        const newKey = await derive(p1.value, newSalt);
        // pictures first, so a failure part-way leaves the old key still valid
        for (const item of list) {
          if (!item.img) continue;
          const plain = await getImage(item.img);
          if (plain) await Store.putImg(IMG + item.img, await sealImg(plain, newKey));
        }
        salt = newSalt; ckey = newKey;
        await persist();
        closeGate(); toast('Passphrase changed.');
      } catch (e) {
        go.disabled = false; go.textContent = 'Change it';
        err.textContent = 'Could not finish. Nothing was changed.'; err.classList.add('bad');
      }
    };
    [p1, p2].forEach(i => i.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); if (i === p1) p2.focus(); else go.click(); }
    }));
  }

  /* ══════════════ show / hide the view ══════════════ */
  function enter() {
    isOpen = true;
    document.querySelectorAll('.view').forEach(s => s.classList.remove('on'));
    document.querySelectorAll('.nav-item[data-view]').forEach(t => t.classList.remove('active'));
    const v = document.getElementById('view-vault');
    v.classList.add('on');
    document.querySelector('.stage') && (document.querySelector('.stage').scrollTop = 0);
    // deliberately not written to ui.view — a reload never lands you back in here
    q = ''; kind = 'thought'; pendingImg = null;
    const s = document.getElementById('vtSearch'); if (s) s.value = '';
    render();
    bumpIdle();
  }

  function lock(silent) {
    if (!isOpen) return;
    isOpen = false;
    ckey = null; salt = null; list = []; pendingImg = null; q = '';
    clearTimeout(idleTimer); clearTimeout(hiddenTimer);
    closeGate();
    const v = document.getElementById('view-vault');
    if (v) v.classList.remove('on');
    ['vtInput', 'vtWho', 'vtSearch'].forEach(id => { const n = document.getElementById(id); if (n) n.value = ''; });
    const l = document.getElementById('vtList'); if (l) l.innerHTML = '';
    const t = document.getElementById('vtTagRow'); if (t) t.innerHTML = '';
    paintAttach();
    const lb = document.getElementById('galleryLightbox');
    if (lb) { lb.classList.add('hidden'); const im = document.getElementById('galleryLbImg'); if (im) im.src = ''; }
    // put a normal screen back up if nothing else claimed it
    if (!silent && !document.querySelector('.view.on')) {
      const back = Store.get('ui.view', 'books');
      const item = document.querySelector(`.nav-item[data-view="${back}"]`);
      if (item) item.click();
    }
  }

  function bumpIdle() {
    if (!isOpen) return;
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { lock(); toast('Locked.'); }, IDLE_MS);
  }

  /* ══════════════ the notes — a twin of the Margin ══════════════ */
  function readFileAsDataUrl(file) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
  }
  function shrink(dataUrl, maxDim = 1600) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        let { width: w, height: h } = img;
        if (w <= maxDim && h <= maxDim) return res(dataUrl);
        const sc = maxDim / Math.max(w, h);
        w = Math.round(w * sc); h = Math.round(h * sc);
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        res(c.toDataURL('image/jpeg', 0.86));
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });
  }
  async function stageFile(file) {
    if (!file || !file.type || !file.type.startsWith('image/')) return;
    pendingImg = await shrink(await readFileAsDataUrl(file));
    paintAttach();
  }
  function paintAttach() {
    const wrap = document.getElementById('vtAttachPreview'), thumb = document.getElementById('vtAttachThumb');
    if (!wrap || !thumb) return;
    if (pendingImg) { thumb.style.backgroundImage = `url(${pendingImg})`; wrap.hidden = false; }
    else { thumb.style.backgroundImage = ''; wrap.hidden = true; }
  }

  async function add() {
    if (!isOpen) return;
    const ta = document.getElementById('vtInput');
    const text = ta.value.trim();
    if (!text && !pendingImg) return;
    const who = document.getElementById('vtWho').value.trim();
    const entry = { id: uid(), text, kind, who, at: Date.now() };
    if (pendingImg) {
      entry.img = uid();
      await putImage(entry.img, pendingImg);   // no copy to the Gallery, on purpose
    }
    list.unshift(entry);
    ta.value = ''; document.getElementById('vtWho').value = '';
    pendingImg = null; paintAttach();
    await persist();
    render();
  }

  function openLightbox(dataUrl, caption) {
    const lb = document.getElementById('galleryLightbox');
    if (!lb) return;
    document.getElementById('galleryLbImg').src = dataUrl;
    document.getElementById('galleryLbMeta').textContent = caption || '';
    lb.classList.remove('hidden');
  }

  function allTags() {
    const set = new Set();
    list.forEach(i => { (i.text || '').replace(/#([\w-]+)/g, (_, t) => { set.add(t); return _; }); });
    return [...set];
  }
  function renderTagRow() {
    const host = document.getElementById('vtTagRow');
    if (!host) return;
    const active = q.startsWith('#') ? q.slice(1) : null;
    host.innerHTML = `<button class="${!q ? 'on' : ''}" data-t="">All</button>` +
      allTags().map(t => `<button class="${active === t ? 'on' : ''}" data-t="${esc(t)}">#${esc(t)}</button>`).join('');
    host.querySelectorAll('button').forEach(b => b.onclick = () => {
      q = b.dataset.t ? '#' + b.dataset.t : '';
      document.getElementById('vtSearch').value = q;
      render();
    });
  }

  function render() {
    const host = document.getElementById('vtList');
    if (!host) return;
    host.innerHTML = '';
    renderTagRow();
    const needle = q.toLowerCase();
    const shown = list.filter(i => !needle || (i.text + ' ' + (i.who || '')).toLowerCase().includes(needle));
    if (!shown.length) {
      host.innerHTML = `<p class="shelf-empty">${list.length ? 'Nothing matches that.' : 'Empty. Type something above and press ⌘/Ctrl+Enter.'}</p>`;
      return;
    }
    shown.forEach(i => {
      const c = el('div', 'note-card' + (i.kind === 'quote' ? ' quote' : '') + (i.img ? ' has-img' : ''));
      const body = esc(i.text).replace(/#([\w-]+)/g, '<span class="tag">#$1</span>');
      c.innerHTML = `${i.img ? '<img class="note-img" alt="">' : ''}
        ${i.text ? `<p>${body}</p>` : ''}${i.who ? `<div class="who">— ${esc(i.who)}</div>` : ''}
        <div class="when">${new Date(i.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>
        <button class="x">✕</button>`;
      if (i.img) {
        const imgEl = c.querySelector('.note-img');
        getImage(i.img).then(u => {
          if (!u || !isOpen) return;
          imgEl.src = u;
          imgEl.onclick = () => openLightbox(u, i.who ? `— ${i.who}` : '');
        });
      }
      c.querySelectorAll('.tag').forEach(t => t.onclick = () => { q = t.textContent; document.getElementById('vtSearch').value = q; render(); });
      c.querySelector('.x').onclick = async () => {
        if (i.img) Store.delImg(IMG + i.img);
        list = list.filter(x => x !== i);
        await persist(); render();
      };
      const p = c.querySelector('p');
      if (p) p.ondblclick = async () => {
        const v = prompt('Edit', i.text);
        if (v != null) { i.text = v; await persist(); render(); }
      };
      host.appendChild(c);
    });
  }

  /* ══════════════ wiring ══════════════ */
  function init() {
    if (wired) return;
    wired = true;

    const ta = document.getElementById('vtInput');
    if (!ta) return;

    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add(); } });
    ta.addEventListener('paste', e => {
      const it = [...(e.clipboardData?.items || [])].find(x => x.type && x.type.startsWith('image/'));
      if (!it) return;
      e.preventDefault();
      stageFile(it.getAsFile());
    });
    document.getElementById('vtAttachBtn').onclick = () => document.getElementById('vtAttachFile').click();
    document.getElementById('vtAttachFile').onchange = e => { const f = e.target.files && e.target.files[0]; if (f) stageFile(f); e.target.value = ''; };
    document.getElementById('vtAttachRemove').onclick = () => { pendingImg = null; paintAttach(); };

    document.querySelectorAll('#vtKind button').forEach(b => b.onclick = () => {
      kind = b.dataset.k;
      document.querySelectorAll('#vtKind button').forEach(x => x.classList.toggle('on', x === b));
      document.getElementById('vtWho').hidden = kind !== 'quote';
      ta.placeholder = kind === 'quote'
        ? 'The quote, as written. ⌘/Ctrl+Enter to keep it.'
        : 'A thought, half-formed. ⌘/Ctrl+Enter to keep it, or paste/attach a picture.';
    });
    document.getElementById('vtSearch').oninput = e => { q = e.target.value.trim(); render(); };
    document.getElementById('vtNewBtn').onclick = () => ta.focus();

    // Shift-click the lock to change the passphrase.
    document.getElementById('vtLock').onclick = e => { if (e.shiftKey) changePass(); else { lock(); toast('Locked.'); } };

    /* ---- auto-lock ---- */
    // Capture phase, so this runs before the sidebar router hands over.
    document.addEventListener('click', e => {
      if (!isOpen) return;
      const item = e.target.closest('.nav-item');
      if (!item) return;
      // If it routes somewhere, the sidebar will paint the next screen for
      // us. Settings and Gallery do not, so put the old screen back.
      lock(!!item.dataset.view);
    }, true);

    document.addEventListener('keydown', e => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        if (document.getElementById('vaultGate')) { closeGate(); return; }
        const lb = document.getElementById('galleryLightbox');
        if (lb && !lb.classList.contains('hidden')) return;   // let the lightbox close first
        lock(); toast('Locked.');
        return;
      }
      const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) || document.activeElement.isContentEditable;
      if (!inField && /^[1-9]$/.test(e.key)) lock(true);       // number shortcuts leave the vault
    }, true);

    ['keydown', 'pointerdown', 'wheel'].forEach(ev =>
      document.getElementById('view-vault').addEventListener(ev, bumpIdle, { passive: true }));

    document.addEventListener('visibilitychange', () => {
      if (!isOpen) return;
      if (document.hidden) hiddenTimer = setTimeout(() => lock(true), HIDDEN_MS);
      else { clearTimeout(hiddenTimer); bumpIdle(); }
    });

    window.addEventListener('pagehide', () => lock(true));
  }

  return { init, knock, decoy, lock, get isOpen() { return isOpen; } };
})();
