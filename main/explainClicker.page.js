/* eslint-disable */
// 注入到 BrowserView 页面主世界（不依赖浏览器扩展 API）。由 explainManager 读取并 executeJavaScript。
(() => {
  if (window.__explainAutoClickInstalled) {
    window.__explainAutoClickForceShow?.();
    return;
  }
  window.__explainAutoClickInstalled = true;

  const PANEL_ID = 'explain-auto-click-root';
  const STORAGE_KEY = 'explain-auto-click-settings';
  const LOCK_KEY = 'explain-auto-click-lock';
  const DEFAULTS = { intervalSec: 15, running: false, mode: '1-2', cursor: 0, collapsed: true };
  const EXPLAIN_TEXTS = new Set(['讲解', '取消讲解', '结束讲解']);
  const EXTRA_BTN_TEXTS = new Set(['讲解中']);

  let settings = { ...DEFAULTS };
  let tickTimer = null;
  let busy = false;
  let lastStatus = '插件已加载。可设置 1↔2 轮流点击。';

  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(patch) {
    settings = { ...settings, ...patch };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch {
      /* ignore quota / private mode */
    }
  }

  function clean(text) {
    return (text || '').replace(/\s+/g, '');
  }

  function isVisible(el) {
    if (!el?.getBoundingClientRect) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width >= 6 && rect.height >= 6;
  }

  function isOurUi(el) {
    return Boolean(el.closest?.(`#${PANEL_ID}`));
  }

  function walkDeep(root, visit) {
    const stack = [root];
    while (stack.length) {
      const node = stack.pop();
      if (!node) continue;
      visit(node);
      if (node.shadowRoot) stack.push(node.shadowRoot);
      const children = node.children || [];
      for (let i = 0; i < children.length; i++) stack.push(children[i]);
    }
  }

  function actionTarget(el) {
    return (
      el.closest("button, a, [role='button']") ||
      (el.className && /ant-btn|\bbtn\b/i.test(String(el.className)) ? el : null) ||
      el
    );
  }

  function isRightSideAction(el) {
    const target = actionTarget(el);
    const cls = `${target.className || ''} ${el.className || ''}`;
    if (/tag|badge|corner|ribbon|status|label|mark|tip/i.test(cls)) return false;
    const rect = target.getBoundingClientRect();
    if (rect.left < window.innerWidth * 0.42) return false;
    return (
      target.matches("button, a, [role='button']") ||
      /ant-btn|\bbtn\b/i.test(cls) ||
      getComputedStyle(target).cursor === 'pointer'
    );
  }

  function collectExplainButtons() {
    const found = [];
    walkDeep(document.documentElement, (el) => {
      if (!(el instanceof HTMLElement) || isOurUi(el) || !isVisible(el)) return;
      const text = clean(el.innerText);
      if (!(EXPLAIN_TEXTS.has(text) || EXTRA_BTN_TEXTS.has(text)) || text.length > 4) return;
      const childHasSame = [...el.children].some((child) => clean(child.innerText) === text);
      if (childHasSame && !el.matches("button, a, [role='button']")) return;
      if (!isRightSideAction(el)) return;
      found.push(actionTarget(el));
    });
    const uniq = [];
    for (const el of found) {
      if (uniq.some((u) => u === el || u.contains(el) || el.contains(u))) {
        const i = uniq.findIndex((u) => u === el || u.contains(el) || el.contains(u));
        const prefer =
          el.matches("button, a, [role='button']") || /ant-btn|\bbtn\b/i.test(String(el.className || ''))
            ? el
            : uniq[i];
        uniq[i] = prefer;
        continue;
      }
      uniq.push(el);
    }
    return uniq;
  }

  function explainCountIn(container, buttons) {
    return buttons.filter((b) => container.contains(b)).length;
  }

  function rowOf(el, buttons) {
    let cur = el.parentElement;
    let best = el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      const count = explainCountIn(cur, buttons);
      if (count === 1) best = cur;
      if (count > 1) break;
      cur = cur.parentElement;
    }
    return best;
  }

  function rowIndex(row) {
    if (!row) return -1;
    let best = null;
    walkDeep(row, (node) => {
      if (!(node instanceof HTMLElement) || !isVisible(node)) return;
      const text = clean(node.innerText);
      if (!/^\d{1,3}$/.test(text)) return;
      if (node.children && node.children.length > 3) return;
      const rect = node.getBoundingClientRect();
      if (rect.width > 56 || rect.height > 56 || rect.width < 4) return;
      const item = { n: Number(text), left: rect.left, w: rect.width };
      if (!best || item.left < best.left - 1 || (Math.abs(item.left - best.left) <= 1 && item.w < best.w)) {
        best = item;
      }
    });
    return best ? best.n : -1;
  }

  function listRankedTargets() {
    const all = collectExplainButtons();
    const ranked = all
      .map((el) => {
        const row = rowOf(el, all);
        const idx = rowIndex(row);
        const rect = el.getBoundingClientRect();
        const text = clean(el.innerText);
        const textRank = text === '取消讲解' || text === '讲解' ? 0 : 1;
        return { el, idx, top: rect.top, left: rect.left, textRank, text };
      })
      .sort((a, b) => {
        if (Math.abs(a.top - b.top) > 8) return a.top - b.top;
        if (a.textRank !== b.textRank) return a.textRank - b.textRank;
        return b.left - a.left;
      });

    return ranked.map((item, i) => ({
      ...item,
      pos: i + 1,
      no: item.idx > 0 ? item.idx : i + 1,
      how: item.idx > 0 ? '序号' : '位置'
    }));
  }

  function findExplainByNo(targetNo) {
    const list = listRankedTargets();
    if (!list.length) return null;
    const exact = list.find((x) => x.idx === targetNo);
    if (exact) {
      exact.el.dataset.explainIndex = String(targetNo);
      exact.el.dataset.explainHow = '序号';
      return exact.el;
    }
    const byPos = list.find((x) => x.pos === targetNo);
    if (byPos) {
      byPos.el.dataset.explainIndex = String(targetNo);
      byPos.el.dataset.explainHow = '位置';
      return byPos.el;
    }
    return null;
  }

  function cycleNos() {
    const total = Math.max(1, listRankedTargets().length);
    if (settings.mode === '1') return [1];
    if (settings.mode === 'all') {
      return Array.from({ length: total }, (_, i) => i + 1);
    }
    return total >= 2 ? [1, 2] : [1];
  }

  function currentTargetNo() {
    const cycle = cycleNos();
    const cursor = Number(settings.cursor) || 0;
    return cycle[((cursor % cycle.length) + cycle.length) % cycle.length];
  }

  function advanceCursor() {
    const cycle = cycleNos();
    const cursor = Number(settings.cursor) || 0;
    saveSettings({ cursor: (cursor + 1) % cycle.length });
  }

  function highlight(el) {
    if (!el) return;
    const old = el.getAttribute('style') || '';
    el.setAttribute(
      'style',
      `${old};outline:3px solid #ff2d55 !important;outline-offset:2px !important;background:rgba(255,45,85,.12) !important;`
    );
    setTimeout(() => el.setAttribute('style', old), 1200);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** 已在页面主世界执行，直接模拟可靠点击（替代扩展 background MAIN world 注入） */
  function mainWorldClick(el) {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    let target = el;
    let cur = el;
    for (let i = 0; i < 6 && cur; i++) {
      const text = clean(cur.innerText);
      if (
        cur.matches?.("button, a, [role='button']") ||
        /ant-btn|btn|button/i.test(cur.className || '') ||
        text === '讲解' ||
        text === '取消讲解' ||
        text === '讲解中'
      ) {
        target = cur;
        break;
      }
      cur = cur.parentElement;
    }
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    target.focus?.();
    target.click();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
    target.dispatchEvent(new MouseEvent('mousedown', opts));
    target.dispatchEvent(new MouseEvent('mouseup', opts));
    target.dispatchEvent(new MouseEvent('click', opts));
    return true;
  }

  async function reliableClick(el) {
    const target =
      el.closest("button, a, [role='button']") ||
      (el.className && /ant-btn|btn/i.test(el.className) ? el : null) ||
      el;
    highlight(target);
    target.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'auto' });
    await sleep(120);
    try {
      mainWorldClick(target);
      return true;
    } catch {
      /* fall through */
    }
    try {
      target.focus?.();
      target.click();
    } catch {
      /* ignore */
    }
    const opts = {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: target.getBoundingClientRect().left + 4,
      clientY: target.getBoundingClientRect().top + 4,
      button: 0
    };
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      const Ev = type.startsWith('pointer') ? PointerEvent : MouseEvent;
      target.dispatchEvent(new Ev(type, opts));
    });
    return true;
  }

  function setStatus(text) {
    lastStatus = text;
    const el = document.getElementById(PANEL_ID)?.querySelector('#explain-auto-status');
    if (el) el.textContent = text;
  }

  function acquireLock() {
    try {
      const now = Date.now();
      const prev = Number(localStorage.getItem(LOCK_KEY) || 0);
      if (prev && now - prev < 1800) return false;
      localStorage.setItem(LOCK_KEY, String(now));
      return true;
    } catch {
      return true;
    }
  }

  async function clickCurrentTarget() {
    const targetNo = currentTargetNo();
    const cycle = cycleNos();
    const all = listRankedTargets();
    const btn = findExplainByNo(targetNo);
    if (!btn) {
      setStatus(`没找到 ${targetNo} 号讲解按钮（右侧共 ${all.length} 个）。`);
      return false;
    }
    if (!acquireLock()) {
      setStatus('其他窗口正在点击，跳过一次。');
      return false;
    }

    const label = clean(btn.innerText);
    const how = btn.dataset.explainHow || '';
    setStatus(`准备点击 ${targetNo} 号：${label}（${how}，下一轮 ${cycle.join('→')}）`);
    await reliableClick(btn);

    if (label === '取消讲解' || label === '讲解中' || label === '结束讲解') {
      setStatus(`已点「${label}」，1.2 秒后再点 ${targetNo} 号「讲解」`);
      await sleep(1200);
      const again = findExplainByNo(targetNo);
      if (!again) {
        setStatus(`${targetNo} 号已取消，但还没出现「讲解」，下轮再试。`);
        advanceCursor();
        return false;
      }
      await reliableClick(again);
      setStatus(`完成 ${targetNo} 号：${label} → ${clean(again.innerText)}`);
    } else {
      setStatus(`已点击 ${targetNo} 号「${label}」`);
    }

    advanceCursor();
    const nextNo = currentTargetNo();
    setStatus(`已点 ${targetNo} 号，下次将点 ${nextNo} 号`);
    return true;
  }

  function clearTick() {
    if (tickTimer) clearTimeout(tickTimer);
    tickTimer = null;
  }

  function queueTick(delay) {
    clearTick();
    tickTimer = setTimeout(runCycle, delay);
  }

  async function runCycle() {
    if (!settings.running || busy) return;
    busy = true;
    try {
      await clickCurrentTarget();
    } finally {
      busy = false;
      if (settings.running) {
        queueTick(Math.max(8, Number(settings.intervalSec) || 15) * 1000);
      }
    }
  }

  function startRunning() {
    const already = settings.running;
    saveSettings({ running: true });
    setStatus(`已开始：${modeLabel()}，下次点 ${currentTargetNo()} 号`);
    syncPanel();
    if (!already) runCycle();
  }

  function stopRunning() {
    saveSettings({ running: false });
    clearTick();
    busy = false;
    setStatus('已停止');
    syncPanel();
  }

  function modeLabel() {
    if (settings.mode === '1') return '仅1号';
    if (settings.mode === 'all') return '全部轮流';
    return '1↔2轮流';
  }

  function injectPanel(force) {
    if (document.getElementById(PANEL_ID)) return;
    const hostOk = /(jinritemai|douyin|douyinec)/i.test(location.hostname);
    if (!force && !hostOk && !collectExplainButtons().length) return;

    const host = document.createElement('div');
    host.id = PANEL_ID;
    host.innerHTML = `
      <div id="explain-box" style="
        position:fixed;top:64px;right:8px;z-index:2147483647;width:148px;
        padding:6px 7px;border-radius:8px;background:rgba(33,28,24,.94);color:#F3EEE7;
        font:11px/1.3 Segoe UI,PingFang SC,Microsoft YaHei UI,Microsoft YaHei,sans-serif;
        border:1px solid rgba(232,135,58,.45);box-shadow:0 6px 18px rgba(0,0,0,.35);
        backdrop-filter:blur(6px);
      ">
        <div id="explain-mini" style="display:none;align-items:center;gap:6px;">
          <span id="explain-mini-drag" style="flex:1;font-weight:700;color:#E8873A;cursor:move;font-size:11px;user-select:none;">讲解</span>
          <span id="explain-mini-state" style="color:#A89F94;font-size:10px;">停</span>
          <button id="explain-expand" type="button" title="展开" style="height:20px;padding:0 6px;border:1px solid #3A342E;border-radius:4px;background:#2A241F;color:#F3EEE7;cursor:pointer;font-size:10px;">展开</button>
        </div>
        <div id="explain-full">
          <div style="display:flex;align-items:center;gap:4px;margin-bottom:5px;">
            <div id="explain-drag" style="flex:1;font-weight:700;color:#E8873A;cursor:move;font-size:11px;user-select:none;">
              自动点讲解
            </div>
            <button id="explain-collapse" type="button" title="收起" style="height:18px;padding:0 5px;border:1px solid #3A342E;border-radius:4px;background:#2A241F;color:#A89F94;cursor:pointer;font-size:10px;">收起</button>
          </div>
          <label style="display:flex;align-items:center;gap:4px;color:#A89F94;margin-bottom:4px;font-size:10px;">
            模式
            <select id="explain-mode" style="flex:1;height:22px;border-radius:4px;border:1px solid #3A342E;background:#161310;color:#F3EEE7;font-size:10px;">
              <option value="1-2">1↔2</option>
              <option value="1">仅1</option>
              <option value="all">全部</option>
            </select>
          </label>
          <label style="display:flex;align-items:center;gap:4px;color:#A89F94;margin-bottom:5px;font-size:10px;">
            间隔
            <input id="explain-interval" type="number" min="8" max="120" step="1" style="
              width:40px;height:22px;border-radius:4px;border:1px solid #3A342E;background:#161310;color:#F3EEE7;padding:0 4px;font-size:10px;
            " />
            秒
          </label>
          <div style="display:flex;gap:4px;">
            <button id="explain-start" type="button" style="flex:1;height:24px;border:0;border-radius:4px;background:#E8873A;color:#1A120C;font-weight:700;cursor:pointer;font-size:10px;">开始</button>
            <button id="explain-stop" type="button" style="flex:1;height:24px;border:1px solid #3A342E;border-radius:4px;background:#2A241F;color:#F3EEE7;cursor:pointer;font-size:10px;">停</button>
            <button id="explain-once" type="button" style="flex:1;height:24px;border:1px solid #3A342E;border-radius:4px;background:#2A241F;color:#F3EEE7;cursor:pointer;font-size:10px;">一次</button>
          </div>
          <div id="explain-auto-status" style="margin-top:4px;color:#A89F94;font-size:9px;max-height:28px;overflow:auto;line-height:1.25;"></div>
        </div>
      </div>
    `;
    (document.body || document.documentElement).appendChild(host);

    const box = host.querySelector('#explain-box');
    const full = host.querySelector('#explain-full');
    const mini = host.querySelector('#explain-mini');
    const interval = host.querySelector('#explain-interval');
    const mode = host.querySelector('#explain-mode');

    function setCollapsed(collapsed) {
      settings.collapsed = !!collapsed;
      saveSettings({ collapsed: settings.collapsed });
      full.style.display = collapsed ? 'none' : 'block';
      mini.style.display = collapsed ? 'flex' : 'none';
      box.style.width = collapsed ? 'auto' : '148px';
      box.style.minWidth = collapsed ? '96px' : '';
      syncPanel();
    }

    interval.value = String(settings.intervalSec);
    mode.value = settings.mode || '1-2';
    host.querySelector('#explain-start').addEventListener('click', startRunning);
    host.querySelector('#explain-stop').addEventListener('click', stopRunning);
    host.querySelector('#explain-once').addEventListener('click', () => {
      clickCurrentTarget();
    });
    host.querySelector('#explain-collapse').addEventListener('click', () => setCollapsed(true));
    host.querySelector('#explain-expand').addEventListener('click', () => setCollapsed(false));
    interval.addEventListener('change', () => {
      saveSettings({ intervalSec: Math.max(8, Number(interval.value) || 15) });
      interval.value = String(settings.intervalSec);
    });
    mode.addEventListener('change', () => {
      saveSettings({ mode: mode.value, cursor: 0 });
      setStatus(`已切换为${modeLabel()}，下次从 ${currentTargetNo()} 号开始`);
    });
    setStatus(lastStatus);
    makeDraggable(box, host.querySelector('#explain-drag'));
    makeDraggable(box, host.querySelector('#explain-mini-drag'));
    // 默认收起，少挡画面；需要调参数再点展开
    setCollapsed(settings.collapsed !== false);
    setStatus(`已加载。当前${modeLabel()}，点一次会点 ${currentTargetNo()} 号。`);
  }

  window.__explainAutoClickForceShow = () => {
    injectPanel(true);
    const root = document.getElementById(PANEL_ID);
    const full = root?.querySelector('#explain-full');
    const mini = root?.querySelector('#explain-mini');
    const box = root?.querySelector('#explain-box');
    if (full && mini && box) {
      full.style.display = 'block';
      mini.style.display = 'none';
      box.style.width = '148px';
      saveSettings({ collapsed: false });
    }
    setStatus(`已重新显示面板。当前${modeLabel()}，下次 ${currentTargetNo()} 号。`);
  };

  function syncPanel() {
    const root = document.getElementById(PANEL_ID);
    const start = root?.querySelector('#explain-start');
    const mode = root?.querySelector('#explain-mode');
    const miniState = root?.querySelector('#explain-mini-state');
    if (start) start.textContent = settings.running ? '运行中' : '开始';
    if (mode && mode.value !== settings.mode) mode.value = settings.mode || '1-2';
    if (miniState) {
      miniState.textContent = settings.running ? '跑' : '停';
      miniState.style.color = settings.running ? '#5BAE6E' : '#A89F94';
    }
  }

  function makeDraggable(box, handle) {
    let ox = 0;
    let oy = 0;
    let dragging = false;
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      const rect = box.getBoundingClientRect();
      ox = e.clientX - rect.left;
      oy = e.clientY - rect.top;
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      box.style.left = `${Math.max(8, e.clientX - ox)}px`;
      box.style.top = `${Math.max(8, e.clientY - oy)}px`;
      box.style.right = 'auto';
    });
    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function watchStorage() {
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY) return;
      let next = { ...DEFAULTS };
      try {
        next = { ...DEFAULTS, ...JSON.parse(event.newValue || '{}') };
      } catch {
        /* ignore */
      }
      const wasRunning = settings.running;
      settings = next;
      const root = document.getElementById(PANEL_ID);
      const input = root?.querySelector('#explain-interval');
      const mode = root?.querySelector('#explain-mode');
      if (input) input.value = String(settings.intervalSec);
      if (mode) mode.value = settings.mode || '1-2';
      syncPanel();
      if (settings.running && !wasRunning) runCycle();
      if (!settings.running && wasRunning) {
        clearTick();
        busy = false;
        setStatus('已停止');
      }
    });
  }

  function init() {
    settings = loadSettings();
    injectPanel(false);
    watchStorage();
    let queued = false;
    new MutationObserver(() => {
      if (queued || document.getElementById(PANEL_ID)) return;
      queued = true;
      setTimeout(() => {
        queued = false;
        injectPanel(false);
      }, 500);
    }).observe(document.documentElement, { childList: true, subtree: true });
    if (settings.running) queueTick(800);
  }

  init();
})();
