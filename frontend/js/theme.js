/**
 * GOLDEN GRAINS - Theme + top-bar tools (loaded in <head> on every app page)
 *  - Dark / light theme, remembered per browser
 *  - Sun/moon button and notification bell in the top bar
 *  - Smooth page transitions between pages
 *  - Shared helper: stockBarHTML() for the green / gold / red stock bars
 */
(function () {
  'use strict';

  var THEME_KEY = 'gg_theme';
  var doc = document.documentElement;

  /* ---------- Theme (applied immediately, before first paint) ---------- */
  function readTheme() {
    try { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; } catch (e) { return 'light'; }
  }
  function applyTheme(t) {
    doc.setAttribute('data-theme', t);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'dark' ? '#031A0E' : '#062E1A');
  }
  applyTheme(readTheme());

  function setTheme(t) {
    doc.classList.add('gg-theme-switching');
    applyTheme(t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) { /* private mode: just don't remember */ }
    setTimeout(function () { doc.classList.remove('gg-theme-switching'); }, 450);
    document.dispatchEvent(new CustomEvent('gg-theme-change', { detail: { theme: t } }));
  }
  window.GGTheme = {
    get: function () { return doc.getAttribute('data-theme') || 'light'; },
    set: setTheme,
    toggle: function () { setTheme(this.get() === 'dark' ? 'light' : 'dark'); }
  };

  /* ---------- Shared helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtN(n) {
    n = Number(n); if (isNaN(n)) return '';
    return String(Math.round(n * 1000) / 1000);
  }
  function moneyTZS(n) {
    return 'TZS ' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });
  }

  /**
   * Slim stock bar. The bar is full at twice the reorder level.
   *   more than the reorder level  -> green  (healthy)
   *   between half and the level    -> gold   (getting low)
   *   below half the reorder level  -> red    (critical)
   * The fill animates in (width starts at 0 and is set a moment later).
   */
  window.stockBarHTML = function (qty, reorder) {
    qty = Number(qty) || 0; reorder = Number(reorder) || 0;
    var ratio = reorder > 0 ? qty / reorder : (qty > 0 ? 2 : 0);
    var cls = ratio > 1 ? 'ok' : (ratio > 0.5 ? 'warn' : 'crit');
    var pct = Math.max(4, Math.min(100, ratio * 50));
    var tip = fmtN(qty) + ' in stock · reorder level ' + fmtN(reorder);
    return '<div class="stockbar ' + cls + '" title="' + esc(tip) + '"><i data-w="' + pct.toFixed(0) + '%"></i></div>';
  };
  /** Fills any freshly inserted bars (so the width transition plays). */
  window.animateStockBars = function (root) {
    var bars = (root || document).querySelectorAll('.stockbar > i[data-w]');
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        bars.forEach(function (b) { b.style.width = b.getAttribute('data-w'); b.removeAttribute('data-w'); });
      });
    });
  };

  /* ---------- Top bar: sun/moon + bell ---------- */
  var ICON_SUN = '<svg class="gg-sun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"></path></svg>';
  var ICON_MOON = '<svg class="gg-moon" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"></path></svg>';
  var ICON_BELL = '<svg viewBox="0 0 24 24"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>';

  // seen = alert keys this user has already viewed (kept on the server, per user).
  // hold = alerts shown in the panel that is open right now; they stay listed until it closes.
  var bellState = { debts: null, low: [], seen: [], hold: {} };

  function isNew(item) {
    if (!item || !item.key) return true;
    return bellState.seen.indexOf(item.key) === -1;
  }
  function isVisible(item) {
    return isNew(item) || !!(item && item.key && bellState.hold[item.key]);
  }

  function allAlertItems() {
    var d = bellState.debts || {};
    return (d.overdue || []).concat(d.due_today || [], d.due_soon || [], bellState.low || []);
  }

  function updateCachedSeen(keys) {
    try {
      var c = JSON.parse(sessionStorage.getItem('gg_alerts_cache') || 'null');
      if (!c || !c.d) return;
      var seen = c.d.seen || [];
      keys.forEach(function (k) { if (seen.indexOf(k) === -1) seen.push(k); });
      c.d.seen = seen;
      sessionStorage.setItem('gg_alerts_cache', JSON.stringify(c));
    } catch (e) { /* ignore */ }
  }

  // The bell was opened: everything new in it counts as seen from now on.
  function markAlertsSeen() {
    var keys = allAlertItems().filter(isNew).map(function (i) { return i.key; }).filter(Boolean);
    if (!keys.length) return;
    keys.forEach(function (k) { bellState.hold[k] = true; bellState.seen.push(k); });
    updateCachedSeen(keys);
    renderBell(); // badge goes to 0; the list stays until the panel closes
    if (window.API && API.post) API.post('dashboard.php', { seen_keys: keys });
  }

  function releaseHeldAlerts() {
    if (!Object.keys(bellState.hold).length) return;
    bellState.hold = {};
    renderBell();
  }

  function buildTools() {
    var userMenu = document.querySelector('.topbar .user-menu');
    if (!userMenu || document.querySelector('.gg-tools')) return;

    var tools = document.createElement('div');
    tools.className = 'gg-tools no-print';
    tools.innerHTML =
      '<button type="button" class="gg-tool-btn gg-theme-btn" aria-label="Switch between light and dark mode" title="Light / dark mode">' +
        ICON_MOON + ICON_SUN + '</button>' +
      '<div class="gg-bell-wrap">' +
        '<button type="button" class="gg-tool-btn gg-bell-btn" aria-label="Notifications" aria-haspopup="true" aria-expanded="false" title="Notifications">' +
          ICON_BELL + '<span class="gg-bell-badge">0</span></button>' +
        '<div class="gg-bell-panel" role="dialog" aria-label="Notifications">' +
          '<div class="gg-bell-head">Notifications <span class="gg-bell-count"></span></div>' +
          '<div class="gg-bell-body"><div class="gg-bell-empty">Checking…</div></div>' +
          '<div class="gg-bell-foot"><a href="debts.html">View debts</a><a href="products.html">View stock</a></div>' +
        '</div>' +
      '</div>';
    userMenu.parentNode.insertBefore(tools, userMenu);

    var themeBtn = tools.querySelector('.gg-theme-btn');
    themeBtn.addEventListener('click', function () {
      window.GGTheme.toggle();
      themeBtn.classList.remove('spin'); void themeBtn.offsetWidth; themeBtn.classList.add('spin');
    });

    var wrap = tools.querySelector('.gg-bell-wrap');
    var btn = tools.querySelector('.gg-bell-btn');
    var panel = tools.querySelector('.gg-bell-panel');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = panel.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) { window.animateStockBars(panel); markAlertsSeen(); } else { releaseHeldAlerts(); }
    });
    function closePanel() {
      var wasOpen = panel.classList.contains('open');
      panel.classList.remove('open'); btn.setAttribute('aria-expanded', 'false');
      if (wasOpen) releaseHeldAlerts();
    }
    document.addEventListener('click', function (e) {
      if (!wrap.contains(e.target)) closePanel();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closePanel();
    });

    renderBell();
    loadAlerts();
    setInterval(loadAlerts, 120000); // refresh every 2 minutes
  }

  function renderBell() {
    var wrap = document.querySelector('.gg-bell-wrap');
    if (!wrap) return;
    var body = wrap.querySelector('.gg-bell-body');
    // Only alerts this person has not seen yet (plus the ones in the panel that is open right now)
    var overdue = ((bellState.debts && bellState.debts.overdue) || []).filter(isVisible);
    var dueToday = ((bellState.debts && bellState.debts.due_today) || []).filter(isVisible);
    var dueSoon = ((bellState.debts && bellState.debts.due_soon) || []).filter(isVisible);
    var low = (bellState.low || []).filter(isVisible);
    var total = overdue.length + dueToday.length + dueSoon.length + low.length;
    var newCount = allAlertItems().filter(isNew).length; // what the red badge counts

    var badge = wrap.querySelector('.gg-bell-badge');
    badge.textContent = newCount > 99 ? '99+' : String(newCount);
    wrap.classList.toggle('has-alerts', newCount > 0);
    wrap.querySelector('.gg-bell-count').textContent = newCount ? newCount + ' new' : '';

    if (bellState.debts === null && !(bellState.low || []).length) return; // still loading

    if (!total) {
      body.innerHTML = '<div class="gg-bell-empty"><b>✓</b>You\'re all caught up — no new notifications.</div>';
      return;
    }
    var html = '';
    function more(n, shown, href, label) {
      return n > shown ? '<a class="gg-bell-item" href="' + href + '"><div class="gg-bi-sub">+ ' + (n - shown) + ' more ' + label + ' →</div></a>' : '';
    }
    if (overdue.length) {
      html += '<div class="gg-bell-group">Overdue debts (' + overdue.length + ')</div>';
      overdue.slice(0, 5).forEach(function (d) {
        html += '<a class="gg-bell-item red" href="debts.html"><div class="gg-bi-top"><span class="gg-bi-name">' + esc(d.customer_name || 'Customer') +
          '</span><span class="gg-bi-val">' + moneyTZS(d.remaining) + '</span></div><div class="gg-bi-sub">Was due ' + esc(d.deadline || '') + '</div></a>';
      });
      html += more(overdue.length, 5, 'debts.html', 'overdue');
    }
    if (dueToday.length) {
      html += '<div class="gg-bell-group">Due today (' + dueToday.length + ')</div>';
      dueToday.slice(0, 5).forEach(function (d) {
        html += '<a class="gg-bell-item gold" href="debts.html"><div class="gg-bi-top"><span class="gg-bi-name">' + esc(d.customer_name || 'Customer') +
          '</span><span class="gg-bi-val">' + moneyTZS(d.remaining) + '</span></div></a>';
      });
      html += more(dueToday.length, 5, 'debts.html', 'due today');
    }
    if (dueSoon.length) {
      html += '<div class="gg-bell-group">Due soon (' + dueSoon.length + ')</div>';
      dueSoon.slice(0, 5).forEach(function (d) {
        var n = Number(d.days_left) || 0;
        var when = n === 1 ? 'Due tomorrow' : 'Due in ' + n + ' days';
        html += '<a class="gg-bell-item gold" href="debts.html"><div class="gg-bi-top"><span class="gg-bi-name">' + esc(d.customer_name || 'Customer') +
          '</span><span class="gg-bi-val">' + moneyTZS(d.remaining) + '</span></div><div class="gg-bi-sub">' + when + ' · ' + esc(d.deadline || '') + '</div></a>';
      });
      html += more(dueSoon.length, 5, 'debts.html', 'due soon');
    }
    if (low.length) {
      html += '<div class="gg-bell-group">Low stock (' + low.length + ')</div>';
      low.slice(0, 6).forEach(function (p) {
        var crit = Number(p.reorder_level) > 0 && Number(p.stock_quantity) / Number(p.reorder_level) <= 0.5;
        html += '<a class="gg-bell-item ' + (crit ? 'red' : 'gold') + '" href="products.html"><div class="gg-bi-top"><span class="gg-bi-name">' + esc(p.name) +
          '</span><span class="gg-bi-val">' + fmtN(p.stock_quantity) + ' ' + esc(p.unit) + '</span></div>' +
          window.stockBarHTML(p.stock_quantity, p.reorder_level) + '</a>';
      });
      html += more(low.length, 6, 'products.html', 'items');
    }
    body.innerHTML = html;
    if (wrap.querySelector('.gg-bell-panel.open')) window.animateStockBars(body);
    else body.querySelectorAll('.stockbar > i[data-w]').forEach(function (b) { b.style.width = b.getAttribute('data-w'); b.removeAttribute('data-w'); });
  }

  function setAlerts(d) {
    bellState.debts = d.debt_alerts || { overdue: [], due_today: [], due_soon: [] };
    bellState.low = d.low_stock_alerts || [];
    bellState.seen = d.seen || [];
    renderBell();
  }

  function loadAlerts() {
    var CK = 'gg_alerts_cache';
    try {
      var c = JSON.parse(sessionStorage.getItem(CK) || 'null');
      if (c && Date.now() - c.t < 45000) { setAlerts(c.d); return; }
    } catch (e) { /* ignore */ }
    if (!window.API || !API.get) return;
    API.get('dashboard.php', { alerts: 1 }).then(function (res) {
      if (!res || !res.success) return;
      try { sessionStorage.setItem(CK, JSON.stringify({ t: Date.now(), d: res.data })); } catch (e) { /* ignore */ }
      setAlerts(res.data);
    });
  }

  // The dashboard already has this data - it hands it over instead of a second request.
  window.GGBell = {
    update: function (d) {
      try { sessionStorage.setItem('gg_alerts_cache', JSON.stringify({ t: Date.now(), d: { debt_alerts: d.debt_alerts, low_stock_alerts: d.low_stock_alerts, seen: d.seen || [] } })); } catch (e) { /* ignore */ }
      setAlerts(d);
    }
  };

  /* ---------- Smooth page transitions ---------- */
  function wireTransitions() {
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest && e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download') || a.classList.contains('js-logout')) return;
      var href = a.getAttribute('href');
      if (!href || href.charAt(0) === '#' || /^(mailto:|tel:|javascript:)/i.test(href)) return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.origin !== location.origin || !/\.html?$/i.test(url.pathname)) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      e.preventDefault();
      document.body.classList.add('gg-leaving');
      setTimeout(function () { location.href = url.href; }, 80);
    });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) document.body.classList.remove('gg-leaving');
    });
  }

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn); else fn();
  }
  ready(function () { buildTools(); wireTransitions(); });
})();
