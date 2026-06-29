import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app-check.js";
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getFirestore, doc, collection, setDoc, deleteDoc, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAh02dU50wou_idDi7caaL9OCQ42-SCAvk",
  authDomain: "like-url-list.firebaseapp.com",
  projectId: "like-url-list",
  storageBucket: "like-url-list.firebasestorage.app",
  messagingSenderId: "121482219485",
  appId: "1:121482219485:web:387e7cdbcc729d76d4b034"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider("6LfqgzUtAAAAAD_DiTJMuZU9jzpNMJPau8Me0YH7"),
  isTokenAutoRefreshEnabled: true
});

let cards = [];
let currentFilterTag = "すべて";
let currentUser = null;

const $ = id => document.getElementById(id);

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function getFavicon(url) {
  try { return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=32`; }
  catch { return ''; }
}

function sanitizeImageUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return (u.protocol === 'https:' || u.protocol === 'http:') ? url : null;
  } catch { return null; }
}

async function saveCardToCloud(c) {
  if (!currentUser) return;
  try {
    const docRef = doc(db, "users", currentUser.uid, "bookmarks", c.id);
    await setDoc(docRef, c);
  } catch (e) { console.error("Cloud save error:", e); }
}

async function deleteCardFromCloud(id) {
  if (!currentUser) return;
  try {
    const docRef = doc(db, "users", currentUser.uid, "bookmarks", id);
    await deleteDoc(docRef);
  } catch (e) { console.error("Cloud delete error:", e); }
}

function syncUI() {
  const n = cards.length;
  const visibleCards = currentFilterTag === "すべて" ? cards : cards.filter(c => c.tags && c.tags.includes(currentFilterTag));
  const hasItems = n > 0 || !!$('cardGrid').querySelector('.card-loading,.card-error');

  $('countBadge').textContent = currentFilterTag === "すべて" ? `${n} 件` : `${visibleCards.length} / ${n} 件`;
  $('emptyState').style.display = hasItems ? 'none' : 'flex';
  $('cardGrid').style.display = hasItems ? 'flex' : 'none';

  renderTagBar();
}

function renderTagBar() {
  const allTagsSet = new Set();
  cards.forEach(c => {
    if (c.tags && Array.isArray(c.tags)) {
      c.tags.forEach(t => { if (t.trim()) allTagsSet.add(t.trim()); });
    }
  });
  const allTags = [...allTagsSet].sort((a, b) => a.localeCompare(b, 'ja'));

  const tagBar = $('tagBar');
  tagBar.innerHTML = '';

  if (!currentUser || cards.length === 0) {
    tagBar.style.display = 'none';
    return;
  }
  tagBar.style.display = 'flex';

  const allBtn = document.createElement('button');
  allBtn.className = `filter-tag-btn ${currentFilterTag === 'すべて' ? 'active' : ''}`;
  allBtn.textContent = `すべて (${cards.length})`;
  allBtn.addEventListener('click', () => {
    currentFilterTag = 'すべて';
    renderAll();
  });
  tagBar.appendChild(allBtn);

  allTags.forEach(tag => {
    const count = cards.filter(c => c.tags && c.tags.includes(tag)).length;
    const btn = document.createElement('button');
    btn.className = `filter-tag-btn ${currentFilterTag === tag ? 'active' : ''}`;

    const label = document.createElement('span');
    label.textContent = `${tag} (${count})`;

    const renameBtn = document.createElement('span');
    renameBtn.className = 'tag-rename-btn';
    renameBtn.textContent = '✎';
    renameBtn.title = 'タグ名を変更';

    const deleteBtn = document.createElement('span');
    deleteBtn.className = 'tag-rename-btn';
    deleteBtn.textContent = '✕';
    deleteBtn.title = 'タグを削除';

    btn.appendChild(label);
    btn.appendChild(renameBtn);
    btn.appendChild(deleteBtn);

    btn.addEventListener('click', (e) => {
      if (e.target === renameBtn || e.target === deleteBtn) return;
      currentFilterTag = tag;
      renderAll();
    });

    renameBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      btn.innerHTML = '';
      const input = document.createElement('input');
      input.className = 'tag-rename-input';
      input.value = tag;
      btn.appendChild(input);
      input.focus();
      input.select();

      const commit = async () => {
        const newTag = input.value.trim();
        if (!newTag || newTag === tag) { renderAll(); return; }
        const targets = cards.filter(c => c.tags && c.tags.includes(tag));
        for (const c of targets) {
          c.tags = c.tags.map(t => t === tag ? newTag : t);
          await saveCardToCloud(c);
        }
        if (currentFilterTag === tag) currentFilterTag = newTag;
        renderAll();
      };

      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.blur(); }
        if (e.key === 'Escape') { renderAll(); }
      });
    });

    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const targets = cards.filter(c => c.tags && c.tags.includes(tag));
      for (const c of targets) {
        c.tags = c.tags.filter(t => t !== tag);
        await saveCardToCloud(c);
      }
      if (currentFilterTag === tag) currentFilterTag = 'すべて';
      renderAll();
    });

    tagBar.appendChild(btn);
  });
}

async function fetchViaMicrolink(url) {
  const res = await fetch(
    `https://api.microlink.io/?url=${encodeURIComponent(url)}&palette=false&audio=false&video=false&iframe=false`,
    { signal: AbortSignal.timeout(12000) }
  );
  if (!res.ok) throw new Error(`microlink HTTP ${res.status}`);
  const d = await res.json();
  if (d.status !== 'success') throw new Error(d.message || 'microlink failed');
  const data = d.data || {};
  const title = data.title || '';
  const description = data.description || '';
  const imageUrl = data.image?.url || data.logo?.url || null;
  if (!title) throw new Error('no title');
  return { title: title.slice(0, 120), description: description.slice(0, 200), imageUrl: sanitizeImageUrl(imageUrl) };
}

function parseOGP(html, pageUrl) {
  const base = new URL(pageUrl).origin;
  function meta(prop) {
    const pats = [
      new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, 'i'),
      new RegExp(`<meta[^>]+name=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+name=["']${prop}["']`, 'i'),
    ];
    for (const re of pats) {
      const m = html.match(re);
      if (m) return m[1].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    }
    return null;
  }
  const titleTag = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = meta('og:title') || meta('twitter:title') || (titleTag ? titleTag[1].trim() : '') || '';
  const description = meta('og:description') || meta('twitter:description') || meta('description') || '';
  let imageUrl = meta('og:image') || meta('twitter:image') || meta('twitter:image:src') || null;
  if (imageUrl) {
    if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
    else if (imageUrl.startsWith('/')) imageUrl = base + imageUrl;
  }
  return { title: title.slice(0, 120), description: description.slice(0, 200), imageUrl: sanitizeImageUrl(imageUrl) };
}

async function fetchViaProxy(url, proxyFn) {
  const res = await fetch(proxyFn(url), { signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`proxy HTTP ${res.status}`);
  const ct = res.headers.get('content-type') || '';
  let html = ct.includes('application/json')
    ? (await res.json().then(j => j.contents || j.body || ''))
    : await res.text();
  if (!html || html.length < 100) throw new Error('empty response');
  const info = parseOGP(html, url);
  if (!info.title) throw new Error('no title found');
  return info;
}

const PROXY_FNS = [
  u => `https://corsproxy.io/?${encodeURIComponent(u)}`,
  u => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}`,
];

async function fetchMeta(url) {
  try { return await fetchViaMicrolink(url); } catch (e) {}
  let lastErr;
  for (const fn of PROXY_FNS) {
    try { return await fetchViaProxy(url, fn); } catch (e) { lastErr = e; }
  }
  try {
    const u = new URL(url);
    return { title: u.hostname + u.pathname, description: '（自動取得に失敗しました。右上の✏️ボタンから手動で編集できます）', imageUrl: null };
  } catch { throw lastErr; }
}

function buildCard(c) {
  const div = document.createElement('div');
  div.className = 'card';
  div.id = `c-${c.id}`;
  const favicon = getFavicon(c.url);

  let tagsHtml = '';
  if (c.tags && c.tags.length > 0) {
    tagsHtml = `<div class="card-tags">`;
    c.tags.forEach(t => { tagsHtml += `<span class="card-tag-item"># ${esc(t)}</span>`; });
    tagsHtml += `</div>`;
  }

  div.innerHTML = `
    <div class="card-body">
      <div class="card-title">${esc(c.title || 'タイトルなし')}</div>
      <div class="card-desc">${esc(c.description || '')}</div>
      ${tagsHtml}
      <div class="card-url-row">
        ${favicon ? `<img class="card-favicon" src="${esc(favicon)}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="card-url-text">${esc(c.url)}</span>
      </div>
    </div>
    <div class="card-thumb-wrap" ${c.imageUrl ? '' : 'style="display:none"'}>
      <div class="card-thumb">
        ${c.imageUrl ? `<img src="${esc(c.imageUrl)}" alt="" loading="lazy" onerror="this.closest('.card-thumb-wrap').style.display='none'">` : ''}
      </div>
    </div>
    <button class="card-action-btn card-del" title="削除">✕</button>
    <button class="card-action-btn card-edit" title="編集">✏️</button>`;

  div.querySelector('.card-del').addEventListener('click', e => { e.stopPropagation(); removeCard(c.id); });
  div.querySelector('.card-edit').addEventListener('click', e => { e.stopPropagation(); editCard(c.id); });
  div.addEventListener('click', () => {
    if (div.classList.contains('editing')) return;
    window.open(c.url, '_blank');
  });
  div.classList.add('card-enter');
  return div;
}

async function removeCard(id) {
  cards = cards.filter(c => c.id !== id);
  const el = $(`c-${id}`);
  if (el) {
    el.classList.add('card-exit');
    await new Promise(r => setTimeout(r, 200));
    el.remove();
  }
  await deleteCardFromCloud(id);

  if (currentFilterTag !== "すべて") {
    const hasTag = cards.some(c => c.tags && c.tags.includes(currentFilterTag));
    if (!hasTag) currentFilterTag = "すべて";
  }
  renderAll();
}

function renderAll() {
  const grid = $('cardGrid');
  grid.querySelectorAll('.card,.card-loading,.card-error').forEach(el => el.remove());

  const targetCards = currentFilterTag === "すべて"
    ? cards
    : cards.filter(c => c.tags && c.tags.includes(currentFilterTag));

  targetCards.forEach(c => grid.appendChild(buildCard(c)));
  syncUI();
}

async function executeFetch(url, id, loaderEl) {
  try {
    const info = await fetchMeta(url);
    const c = { id, url, title: info.title, description: info.description, imageUrl: info.imageUrl, tags: [], createdAt: id };
    cards.unshift(c);
    await saveCardToCloud(c);

    if (currentFilterTag !== "すべて") {
      currentFilterTag = "すべて";
      renderAll();
    } else {
      loaderEl.replaceWith(buildCard(c));
      syncUI();
    }
  } catch (e) {
    const errEl = document.createElement('div');
    errEl.className = 'card-error'; errEl.id = `c-${id}`;
    errEl.innerHTML = `
      <span>取得失敗: ${esc(e.message)}</span>
      <span style="flex:1"></span>
      <button class="err-retry" style="background:var(--card-h);border:1px solid var(--border-h);color:var(--text-1);font-size:11px;padding:4px 10px;border-radius:5px;cursor:pointer;margin-right:6px;font-family:inherit;white-space:nowrap">再取得</button>
      <button class="err-del" style="background:none;border:none;color:var(--text-3);font-size:12px;cursor:pointer;padding:4px 8px;border-radius:5px;font-family:inherit;">削除</button>`;
    errEl.querySelector('.err-retry').addEventListener('click', () => {
      const rl = document.createElement('div');
      rl.className = 'card-loading'; rl.id = `c-${id}`;
      rl.innerHTML = `<div class="spinner"></div><span>再取得中…</span>`;
      errEl.replaceWith(rl);
      executeFetch(url, id, rl).then(syncUI);
    });
    errEl.querySelector('.err-del').addEventListener('click', () => { errEl.remove(); syncUI(); });
    loaderEl.replaceWith(errEl);
    syncUI();
  }
}

async function addURL() {
  if (!currentUser) { alert("ログインが必要です"); return; }
  let url = $('urlInput').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch {
    $('urlInput').classList.add('err');
    setTimeout(() => $('urlInput').classList.remove('err'), 600);
    return;
  }
  $('urlInput').value = '';
  $('addBtn').disabled = true;
  const id = Date.now().toString();
  const grid = $('cardGrid');
  const loader = document.createElement('div');
  loader.className = 'card-loading'; loader.id = `c-${id}`;
  loader.innerHTML = `<div class="spinner"></div><span>取得中: <span style="color:var(--text-4)">${esc(url)}</span></span>`;

  if (grid.firstChild) {
    grid.insertBefore(loader, grid.firstChild);
  } else {
    grid.appendChild(loader);
  }

  syncUI();
  await executeFetch(url, id, loader);
  $('addBtn').disabled = false;
}

$('authBtn').addEventListener('click', async () => {
  if (currentUser) {
    if (confirm("ログアウトしますか？")) { signOut(auth); }
  } else {
    try {
      provider.setCustomParameters({ prompt: 'select_account' });
      await signInWithPopup(auth, provider);
    } catch (e) { alert("ログインに失敗しました"); }
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  if (user) {
    $('authBtn').textContent = "ログアウト";
    $('emptyState').innerHTML = `<div class="spinner"></div><div class="empty-label">データを同期中...</div>`;

    try {
      const q = query(collection(db, "users", user.uid, "bookmarks"), orderBy("createdAt", "desc"));
      const querySnapshot = await getDocs(q);
      cards = [];
      querySnapshot.forEach((doc) => { cards.push(doc.data()); });
    } catch (e) { console.error("Data load error:", e); }

    currentFilterTag = "すべて";
    renderAll();
  } else {
    $('authBtn').textContent = "Googleログイン";
    cards = [];
    $('emptyState').innerHTML = `
      <div class="empty-icon">🔒</div>
      <div class="empty-label">Googleアカウントでログインしてください</div>
      <div class="empty-hint">ログインするとクラウドに無料保存され、データが絶対に消えなくなります</div>`;
    renderAll();
  }
});

$('addBtn').addEventListener('click', addURL);
$('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') addURL(); });
$('urlInput').addEventListener('paste', e => {
  setTimeout(() => { const v = $('urlInput').value.trim(); if (v.startsWith('http')) addURL(); }, 50);
});

// ── 個別手動編集ロジック ──
function editCard(id) {
  const c = cards.find(item => item.id === id);
  if (!c) return;
  const div = document.getElementById(`c-${id}`);
  if (!div || div.classList.contains('editing')) return;

  div.classList.add('editing');
  div.querySelector('.card-action-btn.card-edit').style.display = 'none';
  div.querySelector('.card-action-btn.card-del').style.display = 'none';

  const body = div.querySelector('.card-body');
  const currentTagsStr = (c.tags || []).join(', ');

  body.innerHTML = `
    <div class="edit-label">タイトル</div>
    <input class="edit-field" id="ef-title-${id}" type="text" value="${esc(c.title || '')}" maxlength="120">
    <div class="edit-label">説明文</div>
    <textarea class="edit-field" id="ef-desc-${id}" rows="3" maxlength="200">${esc(c.description || '')}</textarea>
    <div class="edit-label">タグ（カンマ区切り）</div>
    <div class="tag-input-wrap">
      <input class="edit-field" id="ef-tags-${id}" type="text" value="${esc(currentTagsStr)}" placeholder="仕事, あとで読む" autocomplete="off">
      <div class="tag-suggest" id="ef-tags-suggest-${id}" style="display:none"></div>
    </div>
    <div class="edit-label">サムネイル画像URL</div>
    <input class="edit-field" id="ef-img-${id}" type="url" value="${esc(c.imageUrl || '')}" placeholder="https://...">
    <div class="edit-actions">
      <button class="edit-save" id="ef-save-${id}">保存</button>
      <button class="edit-cancel" id="ef-cancel-${id}">キャンセル</button>
    </div>`;

  // タグサジェスト
  const tagsInput = document.getElementById(`ef-tags-${id}`);
  const suggestBox = document.getElementById(`ef-tags-suggest-${id}`);
  let activeIdx = -1;

  tagsInput.addEventListener('input', () => {
    const val = tagsInput.value;
    const lastComma = Math.max(val.lastIndexOf(','), val.lastIndexOf('，'));
    const current = val.slice(lastComma + 1).trim().toLowerCase();

    const allTags = [...new Set(cards.flatMap(c => c.tags || []))];
    const entered = val.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    const filtered = current
      ? allTags.filter(t => t.toLowerCase().includes(current) && !entered.includes(t))
      : [];

    activeIdx = -1;
    if (filtered.length === 0) { suggestBox.style.display = 'none'; return; }

    suggestBox.innerHTML = filtered.map(t =>
      `<div class="tag-suggest-item" data-tag="${esc(t)}">${esc(t)}</div>`
    ).join('');
    suggestBox.style.display = 'block';

    suggestBox.querySelectorAll('.tag-suggest-item').forEach(item => {
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const val = tagsInput.value;
        const lastComma = Math.max(val.lastIndexOf(','), val.lastIndexOf('，'));
        const prefix = lastComma >= 0 ? val.slice(0, lastComma + 1) + ' ' : '';
        tagsInput.value = prefix + item.dataset.tag + ', ';
        suggestBox.style.display = 'none';
        tagsInput.focus();
      });
    });
  });

  tagsInput.addEventListener('keydown', (e) => {
    const items = suggestBox.querySelectorAll('.tag-suggest-item');
    if (!items.length || suggestBox.style.display === 'none') return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      activeIdx = (activeIdx + 1) % items.length;
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      activeIdx = (activeIdx - 1 + items.length) % items.length;
      items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    } else if (e.key === 'Enter' && activeIdx >= 0) {
      e.preventDefault();
      items[activeIdx].dispatchEvent(new MouseEvent('mousedown'));
    } else if (e.key === 'Escape') {
      suggestBox.style.display = 'none';
    }
  });

  tagsInput.addEventListener('blur', () => {
    setTimeout(() => { suggestBox.style.display = 'none'; }, 150);
  });

  div.onclick = null;

  document.getElementById(`ef-cancel-${id}`).addEventListener('click', (e) => {
    e.stopPropagation();
    renderAll();
  });

  document.getElementById(`ef-save-${id}`).addEventListener('click', (e) => {
    e.stopPropagation();
    c.title       = document.getElementById(`ef-title-${id}`).value.trim() || 'タイトルなし';
    c.description = document.getElementById(`ef-desc-${id}`).value.trim();
    c.imageUrl    = sanitizeImageUrl(document.getElementById(`ef-img-${id}`).value.trim());
    c.tags        = document.getElementById(`ef-tags-${id}`).value
                      .split(/[,，]/).map(t => t.trim()).filter(t => t.length > 0);
    saveCardToCloud(c);
    if (currentFilterTag !== 'すべて' && (!c.tags || !c.tags.includes(currentFilterTag))) {
      currentFilterTag = 'すべて';
    }
    renderAll();
  });
}
