/**
 * GOLDEN GRAINS - Dashboard page logic
 */
let DASHBOARD_DATA = null;
const REDUCE_MOTION = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function escHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function shortMoney(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(Math.round(n));
}
function greetingFor(date) {
  const h = (date || new Date()).getHours();
  return h < 12 ? 'Good morning' : (h < 17 ? 'Good afternoon' : 'Good evening');
}
function firstNameOf(user) {
  const first = ((user && user.full_name) || '').trim().split(/\s+/)[0];
  return first ? first.charAt(0).toUpperCase() + first.slice(1).toLowerCase() : '';
}

/* ------------------------------------------------------------------ */
/*  Welcome animation (shown once, right after logging in)             */
/* ------------------------------------------------------------------ */
(function welcomeAnimation() {
  let flag = null;
  try { flag = sessionStorage.getItem('ggWelcome'); sessionStorage.removeItem('ggWelcome'); } catch (e) { /* ignore */ }
  const box = document.getElementById('welcomeOverlay');
  if (!flag || !box || REDUCE_MOTION) return;

  const first = flag === '1' ? '' : firstNameOf({ full_name: flag });
  document.getElementById('woHello').textContent = greetingFor();
  document.getElementById('woName').textContent = first || 'Golden Grains';

  const grains = document.getElementById('woGrains');
  let html = '';
  for (let i = 0; i < 26; i++) {
    html += '<span style="--x:' + (Math.random() * 100).toFixed(1) + '%;--s:' + (6 + Math.random() * 9).toFixed(1) +
      'px;--d:' + (2.4 + Math.random() * 2).toFixed(1) + 's;--delay:' + (Math.random() * 1.2).toFixed(2) + 's"></span>';
  }
  grains.innerHTML = html;

  box.classList.add('show');
  document.body.classList.add('welcome-active');
  let closed = false;
  const close = () => {
    if (closed) return; closed = true;
    box.classList.add('out');
    setTimeout(() => { box.classList.remove('show', 'out'); document.body.classList.remove('welcome-active'); }, 650);
  };
  box.addEventListener('click', close);
  setTimeout(close, 2600);
})();

/* ------------------------------------------------------------------ */
/*  Hero: greeting, date tile, live clock                              */
/* ------------------------------------------------------------------ */
let HERO_USER = null;
function paintDashHero(user) {
  if (user) HERO_USER = user;
  const now = new Date();
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  const first = firstNameOf(HERO_USER);

  set('dhGreeting', greetingFor(now) + (first ? ', ' + first : '') + ' · Your Dashboard Awaits');
  if (first) set('dhName', first);
  set('dhDow', now.toLocaleDateString('en-GB', { weekday: 'long' }));
  set('dhDay', String(now.getDate()));
  set('dhMonth', now.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }));
}
function startClock() {
  const el = document.getElementById('dhClock');
  if (!el) return;
  let lastMinute = -1;
  const tick = () => {
    const n = new Date();
    el.innerHTML = String(n.getHours()).padStart(2, '0') + '<i>:</i>' + String(n.getMinutes()).padStart(2, '0') +
      '<small>' + String(n.getSeconds()).padStart(2, '0') + '</small>';
    if (n.getMinutes() !== lastMinute) { lastMinute = n.getMinutes(); paintDashHero(); } // greeting follows the time of day
  };
  tick();
  setInterval(tick, 1000);
}

/* ------------------------------------------------------------------ */
/*  Count-up numbers                                                   */
/* ------------------------------------------------------------------ */
function countUp(el, target, fmt, duration) {
  if (!el) return;
  target = Number(target) || 0;
  fmt = fmt || (v => String(Math.round(v)));
  if (REDUCE_MOTION || target === 0) { el.textContent = fmt(target); return; }
  duration = duration || 1100;
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * eased);
    if (t < 1) requestAnimationFrame(step); else el.textContent = fmt(target);
  };
  el.textContent = fmt(0);
  requestAnimationFrame(step);
}
const fmtMoneyInt = v => money(Math.round(v));
const fmtInt = v => String(Math.round(v));

/* ------------------------------------------------------------------ */
/*  Trend arrows on the cards                                          */
/* ------------------------------------------------------------------ */
/** higherIsBetter=false for things like expenses and damages, where going up is bad news. */
function setTrend(id, cur, prev, label, higherIsBetter) {
  const el = document.getElementById(id);
  if (!el) return;
  if (prev === undefined || prev === null || cur === undefined || cur === null) { el.innerHTML = ''; return; }
  cur = Number(cur) || 0; prev = Number(prev) || 0;
  // Plain words instead of percentages: "Higher than yesterday" / "Lower than yesterday" / "Same as yesterday".
  let cls, arrow, text;
  if (Math.abs(cur - prev) < 0.005) {
    cls = 'flat'; arrow = '–'; text = 'Same as ' + label;
  } else {
    const up = cur > prev;
    cls = (up === higherIsBetter) ? 'good' : 'bad';
    arrow = up ? '▲' : '▼';
    text = (up ? 'Higher' : 'Lower') + ' than ' + label;
  }
  el.innerHTML = '<span class="tr ' + cls + '"><b>' + arrow + '</b> ' + text + '</span>';
}

/* ------------------------------------------------------------------ */
/*  Sales trend line chart (plain SVG - works offline, no libraries)   */
/* ------------------------------------------------------------------ */
let TREND_DAYS = 7;

function niceMax(v) {
  if (v <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return step * pow;
}

function renderTrendChart(animate) {
  const host = document.getElementById('trendChart');
  const sub = document.getElementById('trendSub');
  if (!host || !DASHBOARD_DATA) return;
  host.classList.toggle('static', animate === false); // a window resize redraws without replaying the draw-in
  const all = DASHBOARD_DATA.sales_trend || [];
  const data = all.slice(-TREND_DAYS);
  if (!data.length) { host.innerHTML = '<div class="chart-empty">No sales data yet.</div>'; if (sub) sub.textContent = ''; return; }

  const total = data.reduce((s, d) => s + d.total, 0);
  const best = data.reduce((b, d) => (d.total > b.total ? d : b), data[0]);
  const dayName = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  if (sub) {
    sub.innerHTML = 'Total <strong>' + money(total) + '</strong> · average <strong>' + money(total / data.length) + '</strong> a day' +
      (best.total > 0 ? ' · best day <strong>' + escHtml(dayName(best.date)) + '</strong>' : '');
  }

  const W = Math.max(280, host.clientWidth || 600), H = 230;
  const m = { l: 46, r: 14, t: 16, b: 30 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const max = niceMax(Math.max.apply(null, data.map(d => d.total)));
  const n = data.length;
  const X = i => m.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const Y = v => m.t + ih - (v / max) * ih;

  let line = '';
  data.forEach((d, i) => {
    const x = X(i), y = Y(d.total);
    if (i === 0) line += 'M' + x.toFixed(1) + ' ' + y.toFixed(1);
    else {
      const px = X(i - 1), py = Y(data[i - 1].total), mx = (px + x) / 2;
      line += ' C' + mx.toFixed(1) + ' ' + py.toFixed(1) + ' ' + mx.toFixed(1) + ' ' + y.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1);
    }
  });
  const base = (m.t + ih).toFixed(1);
  const area = line + ' L' + X(n - 1).toFixed(1) + ' ' + base + ' L' + X(0).toFixed(1) + ' ' + base + ' Z';

  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, y = Y(v).toFixed(1);
    grid += '<line class="tc-grid" x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y + '" y2="' + y + '"/>' +
            '<text class="tc-ylab" x="' + (m.l - 8) + '" y="' + (Number(y) + 3.5) + '" text-anchor="end">' + shortMoney(v) + '</text>';
  }
  let xl = '';
  const every = n <= 8 ? 1 : Math.ceil(n / 7);
  data.forEach((d, i) => {
    const isToday = i === n - 1;
    if (!(i % every === 0 || isToday)) return;
    if (isToday === false && (n - 1 - i) < every / 2 && i !== 0) return; // avoid crowding next to "Today"
    const dt = new Date(d.date + 'T00:00:00');
    const label = isToday ? 'Today' : (n <= 8 ? dt.toLocaleDateString('en-GB', { weekday: 'short' }) : dt.getDate() + ' ' + dt.toLocaleDateString('en-GB', { month: 'short' }));
    xl += '<text class="tc-xlab' + (isToday ? ' today' : '') + '" x="' + X(i).toFixed(1) + '" y="' + (H - 9) + '" text-anchor="middle">' + label + '</text>';
  });
  let dots = '';
  data.forEach((d, i) => {
    if (n <= 8 || i === n - 1) dots += '<circle class="tc-dot' + (i === n - 1 ? ' last' : '') + '" cx="' + X(i).toFixed(1) + '" cy="' + Y(d.total).toFixed(1) + '" r="' + (i === n - 1 ? 4.5 : 3.2) + '" style="animation-delay:' + (0.5 + i * 0.05).toFixed(2) + 's"/>';
  });

  host.innerHTML =
    '<svg class="tc-svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" role="img" aria-label="Sales for the last ' + n + ' days">' +
      '<defs><linearGradient id="tcFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E7A81B" stop-opacity=".42"/><stop offset="1" stop-color="#E7A81B" stop-opacity="0"/></linearGradient></defs>' +
      grid + xl +
      '<path class="tc-area" d="' + area + '" fill="url(#tcFill)"/>' +
      '<path class="tc-line" d="' + line + '" pathLength="1"/>' +
      dots +
      '<line class="tc-guide" id="tcGuide" y1="' + m.t + '" y2="' + base + '" x1="0" x2="0"/>' +
      '<circle class="tc-hover" id="tcHover" r="5.5" cx="0" cy="0"/>' +
      '<rect class="tc-hit" x="' + m.l + '" y="' + m.t + '" width="' + iw + '" height="' + ih + '"/>' +
    '</svg><div class="tc-tip" id="tcTip"></div>';

  const svg = host.querySelector('svg'), tip = host.querySelector('#tcTip');
  const guide = svg.querySelector('#tcGuide'), hov = svg.querySelector('#tcHover');
  const hit = svg.querySelector('.tc-hit');
  const show = (clientX) => {
    const r = svg.getBoundingClientRect();
    const px = (clientX - r.left) * (W / r.width);
    let i = n === 1 ? 0 : Math.round(((px - m.l) / iw) * (n - 1));
    i = Math.max(0, Math.min(n - 1, i));
    const d = data[i], x = X(i), y = Y(d.total);
    guide.setAttribute('x1', x); guide.setAttribute('x2', x); guide.style.opacity = 1;
    hov.setAttribute('cx', x); hov.setAttribute('cy', y); hov.style.opacity = 1;
    tip.innerHTML = '<b>' + escHtml(dayName(d.date)) + '</b>' + money(d.total) + '<span>' + d.count + ' sale' + (d.count === 1 ? '' : 's') + '</span>';
    tip.style.opacity = 1;
    const left = Math.min(Math.max((x / W) * r.width, 60), r.width - 60);
    tip.style.left = left + 'px';
    tip.style.top = Math.max(0, (y / H) * r.height - 62) + 'px';
  };
  const hide = () => { guide.style.opacity = 0; hov.style.opacity = 0; tip.style.opacity = 0; };
  hit.addEventListener('mousemove', e => show(e.clientX));
  hit.addEventListener('mouseleave', hide);
  hit.addEventListener('touchstart', e => show(e.touches[0].clientX), { passive: true });
  hit.addEventListener('touchmove', e => show(e.touches[0].clientX), { passive: true });
  hit.addEventListener('touchend', () => setTimeout(hide, 1200));
}

/* ------------------------------------------------------------------ */
/*  Sales by category donut                                            */
/* ------------------------------------------------------------------ */
let CAT_RANGE = 'month';
const CAT_COLORS = ['#E7A81B', '#3F9B2F', '#1F7A4D', '#C97B2A', '#8FCB5A', '#B9831A', '#6C8F77'];

function renderCategoryChart() {
  const host = document.getElementById('catChart');
  if (!host || !DASHBOARD_DATA) return;
  let rows = ((DASHBOARD_DATA.category_sales || {})[CAT_RANGE] || []).filter(r => r.total > 0);
  const total = rows.reduce((s, r) => s + r.total, 0);
  if (!rows.length || total <= 0) {
    host.innerHTML = '<div class="chart-empty">' + (CAT_RANGE === 'today' ? 'No sales recorded yet today.' : 'No sales recorded this month yet.') + '</div>';
    return;
  }
  if (rows.length > 6) {
    const rest = rows.slice(5).reduce((s, r) => s + r.total, 0);
    rows = rows.slice(0, 5).concat([{ category: 'Other', total: rest }]);
  }
  let acc = 0;
  const segs = rows.map((r, i) => {
    const pct = (r.total / total) * 100;
    const seg = { name: r.category, total: r.total, pct, offset: 25 - acc, color: CAT_COLORS[i % CAT_COLORS.length] };
    acc += pct;
    return seg;
  });
  const gap = segs.length > 1 ? 0.6 : 0;

  host.innerHTML =
    '<div class="donut-wrap">' +
      '<div class="donut">' +
        '<svg viewBox="0 0 42 42" class="donut-svg" role="img" aria-label="Sales by category">' +
          '<circle class="donut-track" cx="21" cy="21" r="15.9155"/>' +
          segs.map((s, i) => '<circle class="donut-seg" data-i="' + i + '" cx="21" cy="21" r="15.9155" stroke="' + s.color + '" ' +
            'data-dash="' + Math.max(0, s.pct - gap).toFixed(2) + ' ' + (100 - Math.max(0, s.pct - gap)).toFixed(2) + '" ' +
            'stroke-dasharray="0 100" stroke-dashoffset="' + s.offset.toFixed(2) + '"/>').join('') +
        '</svg>' +
        '<div class="donut-center"><div class="dc-val" id="dcVal"></div><div class="dc-lab" id="dcLab"></div></div>' +
      '</div>' +
      '<ul class="donut-legend">' +
        segs.map((s, i) => '<li data-i="' + i + '"><span class="dl-dot" style="background:' + s.color + '"></span>' +
          '<span class="dl-name">' + escHtml(s.name) + '</span><span class="dl-pct">' + (s.pct >= 1 ? Math.round(s.pct) : s.pct.toFixed(1)) + '%</span>' +
          '<span class="dl-amt">' + money(s.total) + '</span></li>').join('') +
      '</ul>' +
    '</div>';

  const val = host.querySelector('#dcVal'), lab = host.querySelector('#dcLab');
  const reset = () => {
    val.textContent = 'TZS ' + shortMoney(total);
    lab.textContent = CAT_RANGE === 'today' ? 'today' : 'this month';
    host.querySelectorAll('.on').forEach(e => e.classList.remove('on'));
    host.querySelector('.donut-wrap').classList.remove('focus');
  };
  const focus = (i) => {
    reset();
    const s = segs[i];
    val.textContent = Math.round(s.pct) + '%';
    lab.textContent = s.name;
    host.querySelector('.donut-wrap').classList.add('focus');
    host.querySelectorAll('[data-i="' + i + '"]').forEach(e => e.classList.add('on'));
  };
  reset();
  host.querySelectorAll('.donut-seg, .donut-legend li').forEach(el => {
    el.addEventListener('mouseenter', () => focus(Number(el.dataset.i)));
    el.addEventListener('mouseleave', reset);
    el.addEventListener('click', () => focus(Number(el.dataset.i)));
  });

  // grow the ring in
  requestAnimationFrame(() => requestAnimationFrame(() => {
    host.querySelectorAll('.donut-seg').forEach(c => c.setAttribute('stroke-dasharray', c.dataset.dash));
  }));
}

function wireChartControls() {
  document.querySelectorAll('#trendSeg button').forEach(b => b.addEventListener('click', () => {
    TREND_DAYS = Number(b.dataset.days);
    document.querySelectorAll('#trendSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderTrendChart();
  }));
  document.querySelectorAll('#catSeg button').forEach(b => b.addEventListener('click', () => {
    CAT_RANGE = b.dataset.range;
    document.querySelectorAll('#catSeg button').forEach(x => x.classList.toggle('on', x === b));
    renderCategoryChart();
  }));
  let t;
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    clearTimeout(t);
    t = setTimeout(() => { if (window.innerWidth !== lastW) { lastW = window.innerWidth; renderTrendChart(false); } }, 160);
  });
}

/* ------------------------------------------------------------------ */
/*  Daily sales target + celebration                                   */
/* ------------------------------------------------------------------ */
const TARGET_KEY = 'gg_daily_target';

function savedTarget() {
  try { const v = Number(localStorage.getItem(TARGET_KEY)); return v > 0 ? v : 0; } catch (e) { return 0; }
}
/** Auto target = the shop's average on days that had sales in the last 30 days (not counting today). */
function autoTarget(d) {
  const past = (d.sales_trend || []).slice(0, -1).filter(x => x.total > 0);
  if (!past.length) return 0;
  const avg = past.reduce((s, x) => s + x.total, 0) / past.length;
  return avg >= 2000 ? Math.round(avg / 1000) * 1000 : Math.round(avg);
}

function renderTarget(allowCelebrate) {
  const d = DASHBOARD_DATA;
  if (!d) return;
  const sold = Number(d.today.total_sales) || 0;
  const mine = savedTarget();
  const goal = mine || autoTarget(d);
  const strip = document.getElementById('targetStrip');
  const fill = document.getElementById('tsFill');
  const pctEl = document.getElementById('tsPct');
  const note = document.getElementById('tsNote');

  document.getElementById('tsSold').textContent = money(sold);
  document.getElementById('tsGoal').textContent = goal ? money(goal) : 'not set';

  const pct = goal ? Math.min(100, (sold / goal) * 100) : 0;
  const done = goal > 0 && sold >= goal;
  strip.classList.toggle('done', done);
  setTimeout(() => { fill.style.width = pct.toFixed(1) + '%'; }, 60);
  pctEl.textContent = goal ? Math.min(100, Math.round((sold / goal) * 100)) + '%' : '';

  if (!goal) note.textContent = 'Set a daily target to track how today is going.';
  else if (done) note.textContent = 'Target reached — well done! Tap here to celebrate again.';
  else note.textContent = money(goal - sold) + ' to go' + (mine ? '' : ' · automatic target (your daily average)');

  if (allowCelebrate && done) {
    const key = 'gg_celebrated_' + (d.shop_today || '');
    let already = false;
    try { already = !!localStorage.getItem(key); } catch (e) { /* ignore */ }
    if (!already) {
      try { localStorage.setItem(key, '1'); } catch (e) { /* ignore */ }
      setTimeout(() => { celebrate(); toast('Daily target reached! Great work today.'); }, 900);
    }
  }
}

function wireTarget() {
  const strip = document.getElementById('targetStrip');
  const edit = document.getElementById('tsEdit');
  if (!strip || !edit) return;

  edit.addEventListener('click', (e) => {
    e.stopPropagation();
    let form = strip.querySelector('.ts-form');
    if (form) { form.remove(); return; }
    form = document.createElement('form');
    form.className = 'ts-form';
    form.innerHTML = '<input type="number" min="0" step="any" inputmode="numeric" placeholder="e.g. 500000" aria-label="Daily sales target in TZS">' +
      '<button type="submit" class="btn btn-primary btn-sm">Save</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-auto>Use automatic</button>';
    strip.appendChild(form);
    const input = form.querySelector('input');
    input.value = savedTarget() || '';
    input.focus();
    form.addEventListener('click', ev => ev.stopPropagation());
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = Number(input.value);
      try { if (v > 0) localStorage.setItem(TARGET_KEY, String(v)); else localStorage.removeItem(TARGET_KEY); } catch (err) { /* ignore */ }
      form.remove(); renderTarget(true);
    });
    form.querySelector('[data-auto]').addEventListener('click', () => {
      try { localStorage.removeItem(TARGET_KEY); } catch (err) { /* ignore */ }
      form.remove(); renderTarget(true);
    });
  });
  strip.addEventListener('click', () => { if (strip.classList.contains('done')) celebrate(); });
}

/** A short burst of golden grains and leaf-green confetti. */
function celebrate() {
  if (REDUCE_MOTION) return;
  const cv = document.getElementById('confettiCanvas');
  if (!cv || cv.dataset.running) return;
  cv.dataset.running = '1';
  const dpr = window.devicePixelRatio || 1;
  const W = window.innerWidth, H = window.innerHeight;
  cv.width = W * dpr; cv.height = H * dpr;
  cv.style.display = 'block';
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);

  const colors = ['#FFE9A0', '#F6C04A', '#E7A81B', '#B9831A', '#3F9B2F', '#6BCB5A', '#FFFFFF'];
  const parts = [];
  const burst = (cx, cy, count, spread) => {
    for (let i = 0; i < count; i++) {
      const a = (-Math.PI / 2) + (Math.random() - 0.5) * spread;
      const sp = 7 + Math.random() * 9;
      parts.push({ x: cx, y: cy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
        r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4, c: colors[(Math.random() * colors.length) | 0], life: 0 });
    }
  };
  burst(W * 0.15, H * 0.9, 70, 1.3);
  burst(W * 0.85, H * 0.9, 70, 1.3);
  setTimeout(() => burst(W * 0.5, H * 0.75, 90, 2.2), 350);

  const t0 = performance.now();
  const frame = (now) => {
    const el = now - t0;
    ctx.clearRect(0, 0, W, H);
    parts.forEach(p => {
      p.vy += 0.28; p.vx *= 0.992; p.x += p.vx; p.y += p.vy; p.r += p.vr; p.life++;
      const alpha = Math.max(0, Math.min(1, (3600 - el) / 900));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y); ctx.rotate(p.r);
      ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.ellipse(0, 0, p.w / 2, p.h / 2, 0, 0, 6.2832); ctx.fill(); // grain shape
      ctx.restore();
    });
    if (el < 3600) requestAnimationFrame(frame);
    else { ctx.clearRect(0, 0, W, H); cv.style.display = 'none'; delete cv.dataset.running; }
  };
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/*  Profit overview (admins): all time or a custom date range          */
/* ------------------------------------------------------------------ */
let PROFIT_DATA = null;
let PROFIT_MODE = 'all';

function fmtDay(iso) {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function loadProfit() {
  const net = document.getElementById('pcNet');
  if (!net) return;
  const params = { profit: 1, mode: PROFIT_MODE };
  if (PROFIT_MODE === 'custom') {
    params.from = document.getElementById('pcFrom').value;
    params.to = document.getElementById('pcTo').value;
    if (!params.from || !params.to) return;
  }
  const res = await API.get('dashboard.php', params);
  if (!res.success) { toast(res.message || 'Could not load profit.', 'error'); return; }
  const p = res.data;
  PROFIT_DATA = p;
  countUp(net, p.net_profit, fmtMoneyInt, 700);
  net.classList.toggle('neg', p.net_profit < 0);
  document.getElementById('pcRange').textContent =
    (p.mode === 'all' ? 'All time · ' : '') + fmtDay(p.from) + ' to ' + fmtDay(p.to) + ' · ' + p.transactions + ' sale(s)';
  document.getElementById('pcSales').textContent = money(p.total_sales);
  document.getElementById('pcGross').textContent = money(p.gross_profit);
  document.getElementById('pcExpenses').textContent = money(p.total_expenses);
  document.getElementById('pcDamage').textContent = money(p.total_damage_loss);
}

function wireProfitCard() {
  const seg = document.getElementById('profitSeg');
  const form = document.getElementById('profitForm');
  if (!seg || !form) return;
  const from = document.getElementById('pcFrom');
  const to = document.getElementById('pcTo');
  seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
    PROFIT_MODE = b.dataset.mode;
    seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    form.style.display = PROFIT_MODE === 'custom' ? 'flex' : 'none';
    if (PROFIT_MODE === 'custom') {
      // Start with this month so the card is never empty
      if (!from.value || !to.value) {
        const t = (DASHBOARD_DATA && DASHBOARD_DATA.shop_today) || new Date().toISOString().slice(0, 10);
        from.value = t.slice(0, 8) + '01';
        to.value = t;
      }
    }
    loadProfit();
  }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (from.value > to.value) { toast('The start date cannot be after the end date.', 'error'); return; }
    loadProfit();
  });
}

/* ------------------------------------------------------------------ */
/*  Page start                                                         */
/* ------------------------------------------------------------------ */
(async function init() {
  // Start loading the dashboard data at the same time as the login check (saves a full round trip).
  const dashPromise = API.get('dashboard.php');
  const me = await requireAuth();
  paintDashHero(me);
  startClock();
  wireChartControls();
  wireTarget();
  wireProfitCard();
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  document.getElementById('today-label').textContent = 'Today — ' + dateStr;
  document.getElementById('print-date-dashboard').textContent = dateStr + ' · ' + new Date().toLocaleTimeString('en-GB');

  const res = await dashPromise;
  if (!res.success) { toast(res.message || 'Could not load dashboard.', 'error'); return; }
  const d = res.data;
  DASHBOARD_DATA = d;
  if (window.GGBell) window.GGBell.update(d); // the top-bar bell reuses this data

  // Numbers count up from zero
  countUp(document.getElementById('d-sales'), d.today.total_sales, fmtMoneyInt);
  countUp(document.getElementById('d-transactions'), d.today.transactions, fmtInt);
  countUp(document.getElementById('d-expenses'), d.today.total_expenses, fmtMoneyInt);
  countUp(document.getElementById('d-damage'), d.today.total_damage_loss, fmtMoneyInt);
  countUp(document.getElementById('d-profit'), d.today.net_profit, fmtMoneyInt);
  countUp(document.getElementById('d-credit'), d.today.total_credit || 0, fmtMoneyInt);
  document.getElementById('d-credit-sub').textContent = (d.today.credit_count || 0) + ' sale(s) — view on Debts page';

  countUp(document.getElementById('d-products'), d.stock.total_products, fmtInt);
  countUp(document.getElementById('d-low-stock'), (d.low_stock_alerts || []).length, fmtInt);
  countUp(document.getElementById('d-month-sales'), d.month.total_sales, fmtMoneyInt);
  countUp(document.getElementById('d-month-profit'), d.month.net_profit, fmtMoneyInt);

  // "Higher / Lower than yesterday" arrows (expenses and damages are bad when they go up)
  const y = d.yesterday || {};
  setTrend('t-sales', d.today.total_sales, y.total_sales, 'yesterday', true);
  setTrend('t-transactions', d.today.transactions, y.transactions, 'yesterday', true);
  setTrend('t-expenses', d.today.total_expenses, y.total_expenses, 'yesterday', false);
  setTrend('t-damage', d.today.total_damage_loss, y.total_damage_loss, 'yesterday', false);
  setTrend('t-profit', d.today.net_profit, y.net_profit, 'yesterday', true);
  setTrend('t-month-sales', d.month.total_sales, d.month.prev_total_sales, 'last month', true);

  // Plain-words mirrors of the figures above, shown only in the printed
  // PDF (see .report-summary-text) instead of the on-screen stat cards.
  document.getElementById('d-sales-print').textContent = money(d.today.total_sales);
  document.getElementById('d-transactions-print').textContent = d.today.transactions;
  document.getElementById('d-expenses-print').textContent = money(d.today.total_expenses);
  document.getElementById('d-damage-print').textContent = money(d.today.total_damage_loss);
  document.getElementById('d-profit-print').textContent = money(d.today.net_profit);
  document.getElementById('d-credit-print').textContent = money(d.today.total_credit || 0);
  document.getElementById('d-products-print').textContent = d.stock.total_products;
  document.getElementById('d-low-stock-print').textContent = (d.low_stock_alerts || []).length;
  document.getElementById('d-month-sales-print').textContent = money(d.month.total_sales);
  document.getElementById('d-month-profit-print').textContent = money(d.month.net_profit);

  // Profit overview (admins only - workers never get this data)
  if (me && me.role === 'admin') loadProfit();

  // Charts + target
  renderTrendChart();
  renderCategoryChart();
  renderTarget(true);

  // Top selling today
  const tbody = document.getElementById('topSellingBody');
  if (d.top_selling_today && d.top_selling_today.length) {
    tbody.innerHTML = d.top_selling_today.map(row => `
      <tr>
        <td>${row.name}</td>
        <td>${fmtQty(row.qty_sold)}</td>
        <td>${money(row.revenue)}</td>
        <td class="gold admin-only">${money(row.profit)}</td>
      </tr>`).join('');
    applyRoleVisibility(); // hides the Profit column for workers
  }

  // Debt and stock alerts now live in the notification bell (js/theme.js) - no banners here.

  // Low stock alerts - each item gets a slim bar: green (fine) -> gold (low) -> red (critical)
  if (d.low_stock_alerts && d.low_stock_alerts.length) {
    document.getElementById('lowStockList').innerHTML = d.low_stock_alerts.map(p => `
      <div class="stock-row">
        <div class="stock-top">
          <span class="stock-name">${p.name}</span>
          <span class="tag tag-red">${fmtQty(p.stock_quantity)} ${p.unit} left</span>
        </div>
        ${stockBarHTML(p.stock_quantity, p.reorder_level)}
      </div>`).join('');
    animateStockBars(document.getElementById('lowStockList'));

    document.getElementById('lowStockPrintTable').innerHTML = `
      <div class="table-wrap" style="border:none;">
        <table>
          <thead><tr><th>Product</th><th>Current Stock</th><th>Reorder Level</th><th>Unit</th></tr></thead>
          <tbody>
            ${d.low_stock_alerts.map(p => `
              <tr><td>${p.name}</td><td>${fmtQty(p.stock_quantity)}</td><td>${fmtQty(p.reorder_level)}</td><td>${p.unit}</td></tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;

  } else {
    document.getElementById('lowStockPrintTable').innerHTML =
      '<p class="muted" style="font-size:12.5px;">All stock levels were healthy at the time this was generated.</p>';
  }
})();

/**
 * The Low Stock Alerts card's "Download" produces a ready-to-use supplier
 * Purchase Order for the items running low - not just a list, something a
 * worker can print, hand to (or send) a supplier, fill in prices by hand,
 * and get signed. Layout mirrors the company's official Purchase Order /
 * Supplier Purchase template.
 */
const PURCHASE_ORDER_LOGO = 'assets/logo1.png'; // same file & size as the Cash Audit sheet

function lowStockItemsOrEmpty() {
  const list = (DASHBOARD_DATA && DASHBOARD_DATA.low_stock_alerts) || [];
  if (!list.length) toast('All stock levels are healthy right now - there is nothing to order.', 'error');
  return list;
}

let POF_BUILT = false;

/** Opens the "how many are you going to buy" screen for the items running
 *  low, before anything is downloaded. The PDF/Excel are only generated
 *  once quantities have been entered here. */
function openPurchaseOrderModal() {
  const list = lowStockItemsOrEmpty();
  if (!list.length) return;
  buildPoFillModal();

  document.getElementById('poFillBody').innerHTML = list.map((p, i) => `
    <tr>
      <td>${p.name}</td>
      <td>${p.unit}</td>
      <td>${fmtQty(p.stock_quantity)}</td>
      <td>${fmtQty(p.reorder_level)}</td>
      <td><input type="number" class="po-qty-input" min="0.001" step="any" inputmode="decimal"
                 data-idx="${i}" placeholder="0"></td>
    </tr>`).join('');

  openModal('poFillModal');
}

function buildPoFillModal() {
  if (POF_BUILT) return;
  POF_BUILT = true;
  document.getElementById('poFillCloseBtn').addEventListener('click', () => closeModal('poFillModal'));
  document.getElementById('poFillPdfBtn').addEventListener('click', () => submitPurchaseOrder('pdf'));
  document.getElementById('poFillExcelBtn').addEventListener('click', () => submitPurchaseOrder('excel'));
}

/** Reads the quantities the user just typed in, matches them back to the
 *  low stock list (by position - the table is rebuilt fresh every time the
 *  modal opens, so the order always lines up), and hands off to the PDF
 *  or Excel generator. Every item must have a quantity greater than zero. */
function submitPurchaseOrder(format) {
  const list = lowStockItemsOrEmpty();
  if (!list.length) return;

  const inputs = document.querySelectorAll('#poFillBody .po-qty-input');
  const items = list
    .map((p, i) => {
      const raw = inputs[i] ? parseFloat(inputs[i].value) : NaN;
      return Object.assign({}, p, { buy_qty: raw > 0 ? roundQty(raw) : 0 });
    })
    .filter((p) => p.buy_qty > 0); // only the items actually being bought this time

  if (!items.length) {
    toast('Enter a quantity for at least one item you want to buy.', 'error');
    return;
  }

  closeModal('poFillModal');
  if (format === 'pdf') downloadLowStock(items); else downloadLowStockExcel(items);
}

function purchaseOrderHTML(items) {
  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });

  const rows = items.map((p, i) => `
      <tr>
        <td class="po-c">${i + 1}</td>
        <td>${p.name}</td>
        <td class="po-c">${p.unit}</td>
        <td class="po-c">${fmtQty(p.buy_qty)}</td>
        <td></td>
        <td></td>
        <td><span class="po-remark">${fmtQty(p.stock_quantity)} ${p.unit} left in stock</span></td>
      </tr>`).join('');

  return `
    <div class="po-sheet">
      <div class="po-logo"><img src="${PURCHASE_ORDER_LOGO}" alt="GOLDEN GRAINS"></div>
      <div class="po-heading">
        <div class="po-brand">GOLDEN GRAINS</div>
        <div class="po-title">PURCHASE ORDER / SUPPLIER PURCHASE</div>
      </div>

      <div class="po-business">
        <div><b>Business Name:</b> GOLDEN GRAINS</div>
        <div><b>Phone:</b> +255 715 661 112</div>
      </div>

      <div class="po-fields">
        <div><b>Supplier Name:</b><span class="po-fill"></span></div>
        <div><b>Supplier Contact:</b><span class="po-fill"></span></div>
        <div><b>Date:</b><span class="po-fill">${today}</span></div>
        <div><b>Purchase Ref No:</b><span class="po-fill"></span></div>
      </div>

      <table class="po-table">
        <colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"><col class="c6"><col class="c7"></colgroup>
        <thead>
          <tr><th>S/N</th><th>Item Description</th><th>Unit</th><th>Quantity</th><th>Unit Price</th><th>Total</th><th>Remarks</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <div class="po-totals">
        <div>Subtotal:<span class="po-fill"></span></div>
        <div>Transport Cost:<span class="po-fill"></span></div>
        <div>Other Expenses:<span class="po-fill"></span></div>
        <div>Grand Total:<span class="po-fill"></span></div>
      </div>

      <div class="po-sign">
        <div class="po-sig-block">
          <div class="po-sig-role">Prepared By</div>
          <div class="po-sig-field"><span class="po-sig-label">Name</span><span class="po-sig-line"></span></div>
          <div class="po-sig-field"><span class="po-sig-label">Signature</span><span class="po-sig-line"></span></div>
        </div>
        <div class="po-sig-block">
          <div class="po-sig-role">Supplier Signature</div>
          <div class="po-sig-field"><span class="po-sig-label">Name</span><span class="po-sig-line"></span></div>
          <div class="po-sig-field"><span class="po-sig-label">Signature</span><span class="po-sig-line"></span></div>
        </div>
      </div>
    </div>`;
}

/** Downloads (prints to PDF) the Purchase Order for the items running low -
 *  only that document prints, the rest of the Dashboard stays hidden,
 *  exactly like the Cash Audit sheet's own PDF download. */
async function downloadLowStock(items) {
  if (!items || !items.length) return;

  const box = document.getElementById('purchaseOrderPrint');
  box.innerHTML = purchaseOrderHTML(items);

  const img = box.querySelector('img');
  if (img && img.decode) { try { await img.decode(); } catch (e) { /* print anyway */ } }

  const oldTitle = document.title;
  document.title = 'GOLDEN_GRAINS_Purchase_Order_' + new Date().toISOString().slice(0, 10);
  document.body.classList.add('po-printing');

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('po-printing');
    document.title = oldTitle;
    box.innerHTML = '';
  };
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}

function downloadLowStockExcel(items) {
  if (!items || !items.length) return;

  const today = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
  const rows = [
    ['Business Name:', 'GOLDEN GRAINS'],
    ['Phone:', '+255 715 661 112'],
    [],
    ['Supplier Name:', ''],
    ['Supplier Contact:', ''],
    ['Date:', today],
    ['Purchase Ref No:', ''],
    [],
    ['S/N', 'Item Description', 'Unit', 'Quantity', 'Unit Price', 'Total', 'Remarks'],
    ...items.map((p, i) => [
      i + 1, p.name, p.unit, p.buy_qty, '', '',
      `${fmtQty(p.stock_quantity)} ${p.unit} left in stock`,
    ]),
    [],
    ['Subtotal:', ''],
    ['Transport Cost:', ''],
    ['Other Expenses:', ''],
    ['Grand Total:', ''],
    [],
    ['Prepared By - Name:', ''],
    ['Prepared By - Signature:', ''],
    ['Supplier - Name:', ''],
    ['Supplier - Signature:', ''],
  ];
  exportToExcel('GOLDEN_GRAINS_Purchase_Order_' + new Date().toISOString().slice(0, 10) + '.csv', ['PURCHASE ORDER / SUPPLIER PURCHASE'], rows);
}

function downloadDashboardExcel() {
  if (!DASHBOARD_DATA) { toast('Please wait for the dashboard to finish loading.', 'error'); return; }
  const d = DASHBOARD_DATA;
  const isAdmin = CURRENT_USER && CURRENT_USER.role === 'admin';
  const rows = [
    ['Sales Today', d.today.total_sales],
    ['Transactions Today', d.today.transactions],
    ['Expenses Today', d.today.total_expenses],
    ...(isAdmin ? [['Damage Loss Today', d.today.total_damage_loss], ['Profit Today', d.today.net_profit]] : []),
    [],
    ['Total Products', d.stock.total_products],
    ['Low Stock Items', (d.low_stock_alerts || []).length],
    ['Sales This Month', d.month.total_sales],
    ...(isAdmin ? [['Net Profit This Month', d.month.net_profit]] : []),
    ...(isAdmin && PROFIT_DATA ? [
      [],
      ['PROFIT OVERVIEW (' + PROFIT_DATA.from + ' to ' + PROFIT_DATA.to + ')'],
      ['Sales', PROFIT_DATA.total_sales],
      ['Gross Profit', PROFIT_DATA.gross_profit],
      ['Expenses', PROFIT_DATA.total_expenses],
      ['Damage Loss', PROFIT_DATA.total_damage_loss],
      ['Net Profit', PROFIT_DATA.net_profit],
    ] : []),
    [],
    ['LOW STOCK ALERTS'],
    ['Product', 'Current Stock', 'Reorder Level', 'Unit'],
    ...(d.low_stock_alerts || []).map(p => [p.name, roundQty(p.stock_quantity), roundQty(p.reorder_level), p.unit]),
  ];
  exportToExcel('GOLDEN_GRAINS_Dashboard_' + new Date().toISOString().slice(0, 10) + '.csv', ['Metric', 'Value'], rows);
}

