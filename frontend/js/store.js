/**
 * GOLDEN GRAINS - Store Management
 * Farm -> Main Store (warehouse) -> POS / Shop
 * Tabs: Stock Overview, Farm Receipts, Stock Transfers, Damages, Adjustments, Movement History, Reports
 */
let TAB = 'overview';
let COST_VIEW = 'purchases'; // sub-view of the Costing tab: purchases | stock | processing | history
const COST_VIEW_MAP = { purchases: 'purchases', stock: 'valuation', processing: 'processing', history: 'cost_history' };
const COST_FILTERS = { purchases: ['staff', 'product', 'ref'], stock: ['product', 'location'], processing: ['product', 'location', 'ref'], history: ['product'] };
let META = { staff: [], items: [], products: [], is_admin: false };
let OVERVIEW_ROWS = [];
let LAST_EXPORT = { name: 'Store', headers: [], rows: [] };

const LOCATION_LABEL = { store: 'Main Store', pos: 'POS / Shop' };
const PRESET_LABEL = {
    today: 'Today', yesterday: 'Yesterday', this_week: 'This week', last_week: 'Last week',
    this_month: 'This month', last_month: 'Last month', custom: 'Custom range', all: 'All time',
};
const MOVE_LABEL = {
    farm_receipt: 'Farm receipt', receipt_reversal: 'Farm receipt cancelled',
    transfer_out: 'Transfer out', transfer_in: 'Transfer in', transfer_reversal: 'Transfer cancelled',
    damage: 'Damage', adjustment: 'Adjustment', sale: 'Sale', purchase: 'Purchase (direct to POS)',
};
const TAB_TITLE = {
    overview: 'Stock Overview', transfers: 'Stock Transfers', damages: 'Stock Damage Records',
    adjustments: 'Stock Adjustments', movements: 'Inventory Movement History', report: 'Inventory Report', costing: 'Costing Report',
};
// which of the optional filters each tab uses (period and time are always available)
const TAB_FILTERS = {
    transfers: ['product', 'staff', 'location', 'status'],
    damages: ['product', 'staff', 'location'],
    adjustments: ['product', 'staff', 'location'],
    movements: ['product', 'staff', 'location', 'type'],
    report: ['product', 'staff', 'location'],
};
const STATUS_OPTIONS = {
    transfers: [['pending', 'Pending'], ['approved', 'Approved'], ['completed', 'Completed'], ['cancelled', 'Cancelled']],
};
const LOCATION_FILTER_LABEL = { transfers: 'Source or destination', damages: 'Location of damage', costing: 'Location' };

// which filters the current tab / costing sub-view uses
function activeFilters() { return TAB === 'costing' ? COST_FILTERS[COST_VIEW] : TAB_FILTERS[TAB]; }
function moneyD(n) { return 'TZS ' + (Number(n) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }); }

function esc(v) {
    return String(v === null || v === undefined ? '' : v)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function isAdmin() { return CURRENT_USER && CURRENT_USER.role === 'admin'; }

function fmtDT(ts) {
    if (!ts) return '—';
    const s = String(ts);
    return fmtDate(s.slice(0, 10)) + ' <span class="muted">' + esc(s.slice(11, 19)) + '</span>';
}
function plainDT(ts) { return ts ? String(ts).slice(0, 19) : ''; }

function signedQty(n) {
    n = Number(n) || 0;
    if (n > 0) return '<span class="qty-in">+' + fmtQty(n) + '</span>';
    if (n < 0) return '<span class="qty-out">−' + fmtQty(Math.abs(n)) + '</span>';
    return '0';
}
function plainSigned(n) { n = Number(n) || 0; return (n > 0 ? '+' : n < 0 ? '-' : '') + fmtQty(Math.abs(n)); }

function locTag(loc) {
    if (loc === 'store') return '<span class="tag tag-gold">Main Store</span>';
    if (loc === 'pos') return '<span class="tag tag-green">POS / Shop</span>';
    return '—';
}
function statusTag(st) {
    const cls = { pending: 'tag-gold', approved: 'tag-gold', completed: 'tag-green', cancelled: 'tag-red', active: 'tag-green' }[st] || 'tag-gray';
    return '<span class="tag ' + cls + '">' + esc(st.charAt(0).toUpperCase() + st.slice(1)) + '</span>';
}

(async function init() {
    await requireAuth();
    await loadMeta();
    document.querySelectorAll('#storeTabs .store-tab').forEach(b => b.addEventListener('click', () => setTab(b.dataset.tab)));
    document.getElementById('fPreset').addEventListener('change', () => { syncPresetFields(); if (document.getElementById('fPreset').value !== 'custom') loadTab(); });
    ['tr-item', 'aj-item'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => updateHint(id));
        el.addEventListener('change', () => updateHint(id));
    });
    document.getElementById('tr-direction').addEventListener('change', () => { updateHint('tr-item'); syncProcessBox(); });
    document.getElementById('aj-location').addEventListener('change', () => updateHint('aj-item'));
    document.getElementById('purchaseForm').addEventListener('submit', submitPurchase);
    document.getElementById('pu-method').addEventListener('change', updatePurchasePreview);
    document.getElementById('tr-process').addEventListener('change', syncProcessBox);
    ['tr-out-qty', 'tr-qty', 'tr-out-item', 'tr-item'].forEach(id => document.getElementById(id).addEventListener('input', updateLoss));
    document.getElementById('transferForm').addEventListener('submit', submitTransfer);
    document.getElementById('adjustForm').addEventListener('submit', submitAdjustment);
    const wanted = (location.hash || '').replace('#', '');
    setTab(TAB_TITLE[wanted] && (wanted !== 'costing' || isAdmin()) ? wanted : 'overview');
})();

async function loadMeta() {
    const res = await API.get('store.php', { view: 'meta' });
    if (!res.success) { toast(res.message, 'error'); return; }
    META = res.data;
    document.getElementById('itemOptions').innerHTML = META.items.map(i => `<option value="${esc(i.label)}"></option>`).join('');
    document.getElementById('fProduct').innerHTML = '<option value="">All products</option>' +
        META.products.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    document.getElementById('fStaff').innerHTML = '<option value="">All staff</option>' +
        META.staff.map(u => `<option value="${u.id}">${esc(u.full_name)}</option>`).join('');
}

/* =========================================================
   Tabs + filters
   ========================================================= */
function setTab(tab) {
    TAB = tab;
    history.replaceState(null, '', '#' + tab);
    document.querySelectorAll('#storeTabs .store-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    const card = document.getElementById('filterCard');
    const uses = activeFilters();
    card.classList.toggle('hidden', !uses);
    if (uses) {
        const noPeriod = tab === 'costing' && COST_VIEW === 'stock'; // stock value is "as of now"
        card.querySelectorAll('[data-f="period"]').forEach(el => el.classList.toggle('hidden', noPeriod));
        ['product', 'staff', 'location', 'type', 'status', 'ref'].forEach(f => {
            const el = card.querySelector('[data-f="' + f + '"]');
            if (el) el.classList.toggle('hidden', !uses.includes(f));
        });
        document.getElementById('fLocationLabel').textContent = LOCATION_FILTER_LABEL[tab] || 'Location';
        if (tab === 'costing' && COST_VIEW === 'processing') document.getElementById('fLocationLabel').textContent = 'Arrived at';
        const sel = document.getElementById('fStatus');
        const opts = STATUS_OPTIONS[tab] || [];
        sel.innerHTML = '<option value="">All</option>' + opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('');
        syncPresetFields();
    }
    loadTab();
}

function syncPresetFields() {
    const custom = document.getElementById('fPreset').value === 'custom' && !(TAB === 'costing' && COST_VIEW === 'stock');
    document.querySelectorAll('#filterCard [data-f="custom"]').forEach(el => el.classList.toggle('hidden', !custom));
}

function toggleAdv() {
    const card = document.getElementById('filterCard');
    card.classList.toggle('adv-open');
    document.getElementById('advBtn').textContent = card.classList.contains('adv-open') ? 'Fewer filters' : 'More filters';
}

function resetFilters() {
    document.getElementById('fPreset').value = 'this_month';
    ['fStart', 'fEnd', 'fTimeFrom', 'fTimeTo', 'fProduct', 'fStaff', 'fLocation', 'fType', 'fStatus', 'fRef'].forEach(id => { document.getElementById(id).value = ''; });
    syncPresetFields();
    loadTab();
}

function filterParams() {
    const uses = activeFilters() || [];
    const p = { preset: document.getElementById('fPreset').value };
    if (p.preset === 'custom') {
        p.start = document.getElementById('fStart').value;
        p.end = document.getElementById('fEnd').value;
        if (!p.start && !p.end) p.preset = 'all';
    }
    const tf = document.getElementById('fTimeFrom').value;
    const tt = document.getElementById('fTimeTo').value;
    if (tf) p.time_from = tf;
    if (tt) p.time_to = tt;
    if (uses.includes('product')) p.product_id = document.getElementById('fProduct').value;
    if (uses.includes('staff')) p.user_id = document.getElementById('fStaff').value;
    if (uses.includes('location')) p.location = document.getElementById('fLocation').value;
    if (uses.includes('type')) p.type = document.getElementById('fType').value;
    if (uses.includes('status')) p.status = document.getElementById('fStatus').value;
    if (uses.includes('ref')) p.ref = document.getElementById('fRef').value.trim();
    Object.keys(p).forEach(k => { if (p[k] === '' || p[k] === undefined) delete p[k]; });
    return p;
}

function rangeText(r) {
    if (!r) return '';
    let t = PRESET_LABEL[r.preset] || '';
    if (r.start || r.end) {
        const a = r.start ? fmtDate(r.start) : 'the beginning';
        const b = r.end ? fmtDate(r.end) : 'today';
        t += (r.start && r.start === r.end) ? ' (' + a + ')' : ' (' + a + ' to ' + b + ')';
    }
    if (r.time_from || r.time_to) t += ' · ' + (r.time_from || '00:00') + ' to ' + (r.time_to || '23:59');
    return t;
}

function setPrintInfo(range) {
    document.getElementById('print-title-store').textContent = TAB_TITLE[TAB];
    document.getElementById('print-date-store').textContent = (rangeText(range) ? rangeText(range) + ' · ' : '') + new Date().toLocaleString('en-GB');
}

function statCards(cards) {
    return '<div class="stat-grid no-print" style="margin-bottom:16px;">' + cards.map(c =>
        `<div class="stat-card"><div class="label">${esc(c[0])}</div><div class="value ${c[2] || ''}">${c[1]}</div></div>`).join('') + '</div>';
}
function emptyRow(cols, msg) { return `<tr><td colspan="${cols}" class="muted">${esc(msg)}</td></tr>`; }
function tableHtml(headers, bodyRows) {
    return '<div class="table-wrap"><table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>' + bodyRows + '</tbody></table></div>';
}
function truncNote(t) { return t ? '<p class="store-hint">Showing the latest 500 records. Narrow the filters to see the rest.</p>' : ''; }
function setContent(html) { document.getElementById('tabContent').innerHTML = html; applyRoleVisibility(); }

/* =========================================================
   Loading + rendering each tab
   ========================================================= */
async function loadTab() {
    setContent('<div class="card"><p class="muted">Loading...</p></div>');
    const tab = TAB;
    let res;
    if (tab === 'overview') res = await API.get('store.php', { view: 'overview' });
    else if (tab === 'damages') res = await API.get('damages.php', { ...filterParams(), limit: 500 });
    else if (tab === 'costing') res = await API.get('store.php', { view: COST_VIEW_MAP[COST_VIEW], ...filterParams() });
    else res = await API.get('store.php', { view: tab, ...filterParams() });
    if (tab !== TAB) return; // the person switched tab while this was loading
    if (!res.success) { setContent(`<div class="card"><p class="muted">${esc(res.message)}</p></div>`); return; }

    ({
        overview: renderOverview, transfers: renderTransfers, damages: renderDamages,
        adjustments: renderAdjustments, movements: renderMovements, report: renderReport, costing: renderCosting,
    })[tab](res.data);
}

/* ---- Stock overview ---- */
function renderOverview(data) {
    OVERVIEW_ROWS = data.rows;
    setPrintInfo(null);
    drawOverview();
}
function qtyCell(q, unit, low) {
    const n = Number(q) || 0;
    return (n > 0 ? '<strong>' + fmtQty(n) + '</strong>' : '<span class="muted">0</span>') + ' <span class="muted">' + esc(unit) + '</span>' + (low ? ' <span class="tag tag-low">Low</span>' : '');
}
// "Beans — Chickpeas" -> product "Beans", type "Chickpeas" (a product without types has no type)
function splitLabel(r) {
    const name = r.product_name || r.label;
    const type = Number(r.variant_id) > 0 && r.label.indexOf(name + ' — ') === 0 ? r.label.slice(name.length + 3) : '';
    return { name, type };
}
function drawOverview() {
    const prev = document.getElementById('ov-search') ? document.getElementById('ov-search').value : '';
    const q = prev.trim().toLowerCase();
    const rows = OVERVIEW_ROWS.filter(r => !q || r.label.toLowerCase().includes(q));
    const body = rows.length ? rows.map(r => {
        const p = splitLabel(r);
        return `
      <tr>
        <td><strong>${esc(p.name)}</strong>${r.status === 'disabled' ? ' <span class="tag tag-gray">Disabled</span>' : ''}</td>
        <td>${p.type ? esc(p.type) : '<span class="muted">—</span>'}</td>
        <td>${qtyCell(r.store_qty, r.unit, false)}</td>
        <td>${qtyCell(r.pos_qty, r.unit, Number(r.pos_qty) <= Number(r.reorder_level))}</td>
      </tr>`;
    }).join('') : emptyRow(4, 'No products found.');

    setContent(`<div class="card">
        <div class="store-toolbar no-print"><input type="text" id="ov-search" class="store-search" placeholder="Search products..." value="${esc(prev)}"></div>
        ${tableHtml(['Product', 'Type', 'Main Store', 'POS / Shop'], body)}
      </div>`);
    const el = document.getElementById('ov-search');
    el.addEventListener('input', () => { drawOverview(); const n = document.getElementById('ov-search'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); });

    LAST_EXPORT = {
        name: 'Stock_Overview',
        headers: ['Product', 'Type', 'Unit', 'Main Store', 'POS / Shop'],
        rows: rows.map(r => { const p = splitLabel(r); return [p.name, p.type, r.unit, fmtQty(r.store_qty), fmtQty(r.pos_qty)]; }),
    };
}

/* ---- Transfers ---- */
// "becomes Rice — 65 kg (loss 5 kg)" for stock that was processed on the way to the shop
function processedInfo(t) {
    if (!t.output_name) return '';
    const outQty = Number(t.output_quantity);
    let loss = '';
    if (t.unit === t.output_unit) loss = ' · loss ' + fmtQty(roundQty(Number(t.quantity) - outQty)) + ' ' + esc(t.unit);
    return '<span class="cell-sub">→ ' + esc(t.output_name) + ' ' + fmtQty(outQty) + ' ' + esc(t.output_unit || '') + loss + '</span>';
}
function renderTransfers(data) {
    setPrintInfo(data.range);
    const body = data.rows.length ? data.rows.map(t => {
        let trail = '';
        if (t.status === 'completed' && t.completed_at) trail = 'by ' + (t.completed_by_name || '—');
        else if (t.status === 'approved') trail = 'approved by ' + (t.approved_by_name || '—');
        else if (t.status === 'cancelled') trail = 'by ' + (t.cancelled_by_name || '—');
        let actions = '';
        if (isAdmin()) {
            if (t.status === 'pending') actions += `<button class="btn btn-outline btn-sm" onclick="transferAction(${t.id}, 'approve')">Approve</button>`;
            if (t.status === 'pending' || t.status === 'approved') actions += `<button class="btn btn-primary btn-sm" onclick="transferAction(${t.id}, 'complete')">Complete</button>`;
            if (t.status !== 'cancelled') actions += `<button class="btn btn-outline btn-sm" onclick="transferAction(${t.id}, 'cancel')">Cancel</button>`;
        }
        return `
      <tr class="${t.status === 'cancelled' ? 'row-cancelled' : ''}">
        <td>${fmtDT(t.created_at)}<span class="cell-sub">${esc(t.ref)} · ${esc(t.staff || '—')}</span></td>
        <td><strong>${esc(t.product_name)}</strong>${processedInfo(t)}${t.note ? '<span class="cell-sub">' + esc(t.note) + '</span>' : ''}</td>
        <td><strong>${fmtQty(t.quantity)}</strong> <span class="muted">${esc(t.unit)}</span></td>
        <td>${esc(LOCATION_LABEL[t.source])} → ${esc(LOCATION_LABEL[t.destination])}</td>
        <td>${statusTag(t.status)}${trail ? '<span class="cell-sub">' + esc(trail) + '</span>' : ''}</td>
        <td class="no-print"><div class="store-actions">${actions}</div></td>
      </tr>`;
    }).join('') : emptyRow(6, 'No transfers for this selection.');

    setContent(`<div class="card">
        <div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))}</span><button class="btn btn-primary btn-sm" onclick="openTransferModal()">+ Transfer Stock</button></div>
        ${tableHtml(['When / Who', 'Product', 'Quantity', 'Route', 'Status', '<span class="no-print"></span>'], body)}${truncNote(data.truncated)}</div>`);

    LAST_EXPORT = {
        name: 'Stock_Transfers',
        headers: ['Transfer ID', 'Date & Time', 'Product', 'Quantity', 'Unit', 'From', 'To', 'Staff', 'Status', 'Notes'],
        rows: data.rows.map(t => [t.ref, plainDT(t.created_at), t.product_name, fmtQty(t.quantity), t.unit, LOCATION_LABEL[t.source], LOCATION_LABEL[t.destination], t.staff || '', t.status, t.note || '']),
    };
}

/* ---- Damages (recorded on the Damages & Waste page) ---- */
function renderDamages(rows) {
    setPrintInfo({ preset: document.getElementById('fPreset').value, start: document.getElementById('fStart').value || null, end: document.getElementById('fEnd').value || null });
    const admin = isAdmin();
    const body = rows.length ? rows.map(d => {
        const other = d.item_type === 'other';
        const when = fmtDate(d.damage_date) + ' <span class="muted">' + esc(d.created_at ? String(d.created_at).slice(11, 19) : '') + '</span>';
        return `
      <tr>
        <td>${when}<span class="cell-sub">${esc(d.recorded_by_name)}</span></td>
        <td><strong>${esc(d.display_name || d.product_name || d.item_name || '—')}</strong>${other ? ' <span class="tag tag-gray">Not in Stock</span>' : ''}</td>
        <td>${other ? '—' : locTag(d.location)}</td>
        <td>${other ? '—' : '<strong>' + fmtQty(d.quantity) + '</strong> <span class="muted">' + esc(d.unit || '') + '</span>'}</td>
        <td>${esc(d.reason)}${d.notes ? '<span class="cell-sub">' + esc(d.notes) + '</span>' : ''}</td>
        ${admin ? `<td class="red"><strong>${money(d.display_cost != null ? d.display_cost : d.loss_value)}</strong></td>` : ''}
      </tr>`;
    }).join('') : emptyRow(admin ? 6 : 5, 'No damage recorded for this selection.');

    setContent(`<div class="card">
        <div class="store-toolbar no-print"><span class="muted">${rows.length} record${rows.length === 1 ? '' : 's'}</span><a class="btn btn-primary btn-sm" href="damages.html">+ Record Damage</a></div>
        ${tableHtml(['When / Who', 'Item', 'Location', 'Quantity', 'Reason'].concat(admin ? ['Loss'] : []), body)}</div>`);

    LAST_EXPORT = {
        name: 'Stock_Damages',
        headers: ['Date', 'Time', 'Item', 'Location', 'Quantity', 'Unit', 'Reason', 'Notes'].concat(admin ? ['Loss Value'] : []).concat(['Recorded By']),
        rows: rows.map(d => [d.damage_date, d.created_at ? String(d.created_at).slice(11, 19) : '', d.display_name || d.product_name || d.item_name,
            d.item_type === 'other' ? '' : LOCATION_LABEL[d.location] || '', d.item_type === 'other' ? '' : fmtQty(d.quantity), d.item_type === 'other' ? '' : (d.unit || ''),
            d.reason, d.notes || ''].concat(admin ? [d.display_cost != null ? d.display_cost : d.loss_value] : []).concat([d.recorded_by_name])),
    };
}

/* ---- Adjustments ---- */
function renderAdjustments(data) {
    setPrintInfo(data.range);
    const body = data.rows.length ? data.rows.map(a => `
      <tr>
        <td>${fmtDT(a.created_at)}<span class="cell-sub">${esc(a.ref)} · ${esc(a.staff || '—')}</span></td>
        <td><strong>${esc(a.product_name)}</strong></td>
        <td>${locTag(a.location)}</td>
        <td>${signedQty(a.quantity_change)} <span class="muted">${esc(a.unit)}</span></td>
        <td>${esc(a.reason)}${a.note ? '<span class="cell-sub">' + esc(a.note) + '</span>' : ''}</td>
      </tr>`).join('') : emptyRow(5, 'No stock adjustments for this selection.');

    setContent(`<div class="card">
        <div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))}</span>${isAdmin() ? '<button class="btn btn-primary btn-sm" onclick="openAdjustModal()">+ Adjust Stock</button>' : ''}</div>
        ${tableHtml(['When / Who', 'Product', 'Location', 'Change', 'Reason'], body)}${truncNote(data.truncated)}</div>`);

    LAST_EXPORT = {
        name: 'Stock_Adjustments',
        headers: ['Ref', 'Date & Time', 'Product', 'Location', 'Change', 'Unit', 'Reason', 'Notes', 'Adjusted By'],
        rows: data.rows.map(a => [a.ref, plainDT(a.created_at), a.product_name, LOCATION_LABEL[a.location], plainSigned(a.quantity_change), a.unit, a.reason, a.note || '', a.staff || '']),
    };
}

/* ---- Movement history ---- */
function movementTable(rows) {
    const body = rows.length ? rows.map(m => `
      <tr>
        <td>${fmtDT(m.ts)}<span class="cell-sub">${esc(m.staff)}</span></td>
        <td><strong>${esc(m.product_name)}</strong>${m.note ? '<span class="cell-sub">' + esc(m.note) + '</span>' : ''}</td>
        <td>${esc(MOVE_LABEL[m.mtype] || m.mtype)}<span class="cell-sub">${esc(m.ref)}</span></td>
        <td>${locTag(m.location)}</td>
        <td>${signedQty(m.qty)} <span class="muted">${esc(m.unit)}</span></td>
      </tr>`).join('') : emptyRow(5, 'No movements for this selection.');
    return tableHtml(['When / Who', 'Product', 'What happened', 'Location', 'Change'], body);
}
function movementExportRows(rows) {
    return rows.map(m => [plainDT(m.ts), m.ref, MOVE_LABEL[m.mtype] || m.mtype, m.product_name, LOCATION_LABEL[m.location], plainSigned(m.qty), m.unit, m.staff, m.note || '']);
}
const MOVE_HEADERS = ['Date & Time', 'Reference', 'Type', 'Product', 'Location', 'Change', 'Unit', 'Staff', 'Details'];

function renderMovements(data) {
    setPrintInfo(data.range);
    setContent(`<div class="card">
        <div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))}</span></div>
        ${movementTable(data.rows)}${truncNote(data.truncated)}</div>`);
    LAST_EXPORT = { name: 'Movement_History', headers: MOVE_HEADERS, rows: movementExportRows(data.rows) };
}

/* ---- Reports ---- */
function renderReport(data) {
    setPrintInfo(data.range);
    const loc = document.getElementById('fLocation').value;
    const showStore = loc !== 'pos';
    const showPos = loc !== 'store';
    const t = data.totals;

    const cards = [];
    if (showStore) cards.push(['Received from farm', fmtQty(t.received), 'green'], ['In Main Store', fmtQty(t.store_now), 'gold']);
    if (showPos) cards.push(['At POS / Shop', fmtQty(t.pos_now), 'green']);
    cards.push(['Damaged', fmtQty(roundQty((showStore ? Number(t.damaged_store) : 0) + (showPos ? Number(t.damaged_pos) : 0))), 'red']);

    const heads = ['Product'];
    if (showStore) heads.push('Received', 'Main Store');
    if (showPos) heads.push('To POS', 'POS Now', 'Sold');
    if (showStore) heads.push('Damaged (Store)');
    if (showPos) heads.push('Damaged (POS)');

    const cells = r => {
        const c = [`<td><strong>${esc(r.label)}</strong> <span class="muted">${esc(r.unit)}</span></td>`];
        if (showStore) c.push(`<td>${fmtQty(r.received)}</td>`, `<td><strong>${fmtQty(r.store_now)}</strong></td>`);
        if (showPos) c.push(`<td>${fmtQty(r.to_pos)}</td>`, `<td><strong>${fmtQty(r.pos_now)}</strong></td>`, `<td>${fmtQty(r.sold)}</td>`);
        if (showStore) c.push(`<td>${fmtQty(r.damaged_store)}</td>`);
        if (showPos) c.push(`<td>${fmtQty(r.damaged_pos)}</td>`);
        return '<tr>' + c.join('') + '</tr>';
    };
    const summaryBody = data.summary.length ? data.summary.map(cells).join('') : emptyRow(heads.length, 'Nothing to report for this selection.');

    setContent(
        statCards(cards) +
        `<div class="card">
          <div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))}</span><button class="btn btn-outline btn-sm" onclick="setTab('movements')">View full history</button></div>
          ${tableHtml(heads, summaryBody)}
        </div>`);

    const sumHeaders = ['Product', 'Unit'];
    if (showStore) sumHeaders.push('Received from Farm', 'In Main Store Now');
    if (showPos) sumHeaders.push('Transferred to POS', 'At POS Now', 'Sold');
    if (showStore) sumHeaders.push('Damaged (Store)');
    if (showPos) sumHeaders.push('Damaged (POS)');
    const sumRows = data.summary.map(r => {
        const x = [r.label, r.unit];
        if (showStore) x.push(fmtQty(r.received), fmtQty(r.store_now));
        if (showPos) x.push(fmtQty(r.to_pos), fmtQty(r.pos_now), fmtQty(r.sold));
        if (showStore) x.push(fmtQty(r.damaged_store));
        if (showPos) x.push(fmtQty(r.damaged_pos));
        return x;
    });
    LAST_EXPORT = {
        name: 'Inventory_Report',
        headers: sumHeaders,
        rows: sumRows.concat([[], ['MOVEMENT HISTORY'], MOVE_HEADERS]).concat(movementExportRows(data.rows)),
    };
}

function downloadStoreExcel() {
    exportToExcel('GOLDEN_GRAINS_' + LAST_EXPORT.name + '_' + new Date().toISOString().slice(0, 10) + '.csv', LAST_EXPORT.headers, LAST_EXPORT.rows);
}

/* =========================================================
   Forms: receipt, transfer, adjustment
   ========================================================= */
function findItem(label) {
    const q = (label || '').trim().toLowerCase();
    return META.items.find(i => i.label.toLowerCase() === q) || null;
}

function updateHint(inputId) {
    const hint = document.getElementById({ 'tr-item': 'tr-hint', 'aj-item': 'aj-hint' }[inputId]);
    const item = findItem(document.getElementById(inputId).value);
    if (!item) { hint.classList.add('hidden'); return; }
    let html = `Main Store: <strong>${fmtQty(item.store_qty)}</strong> ${esc(item.unit)} &nbsp;·&nbsp; POS / Shop: <strong>${fmtQty(item.pos_qty)}</strong> ${esc(item.unit)}`;
    if (inputId === 'tr-item') {
        const src = document.getElementById('tr-direction').value.split('>')[0];
        html += `<br>Available to transfer from the ${LOCATION_LABEL[src]}: <strong>${fmtQty(src === 'store' ? item.store_qty : item.pos_qty)}</strong> ${esc(item.unit)}`;
    }
    hint.innerHTML = html;
    hint.classList.remove('hidden');
}

function pickItemOrWarn(inputId) {
    const item = findItem(document.getElementById(inputId).value);
    if (!item) { toast('Please choose a product from the list (type to search).', 'error'); return null; }
    return item;
}

function openTransferModal() {
    document.getElementById('transferForm').reset();
    document.getElementById('tr-hint').classList.add('hidden');
    document.getElementById('tr-costs').innerHTML = '';
    syncProcessBox();
    openModal('transferModal');
}
function openAdjustModal() {
    document.getElementById('adjustForm').reset();
    document.getElementById('aj-hint').classList.add('hidden');
    openModal('adjustModal');
}

async function afterChange(message, tab) {
    toast(message);
    await loadMeta();
    if (tab && tab !== TAB) setTab(tab); else loadTab();
}

async function submitTransfer(e) {
    e.preventDefault();
    const item = pickItemOrWarn('tr-item');
    if (!item) return;
    const [source, destination] = document.getElementById('tr-direction').value.split('>');
    const qty = Number(document.getElementById('tr-qty').value);
    const available = Number(source === 'store' ? item.store_qty : item.pos_qty);
    if (qty > available) {
        toast(`Only ${fmtQty(available)} ${item.unit} of "${item.label}" is available in the ${LOCATION_LABEL[source]}.`, 'error');
        return;
    }
    const payload = {
        action: 'transfer', product_id: item.product_id, variant_id: Number(item.variant_id) || null,
        source, destination, quantity: qty,
        note: document.getElementById('tr-note').value.trim(),
        status: document.getElementById('tr-pending').checked ? 'pending' : 'completed',
    };
    if (processOn()) {
        const out = findItem(document.getElementById('tr-out-item').value);
        const outQty = Number(document.getElementById('tr-out-qty').value);
        if (!out) { toast('Choose the finished product from the list.', 'error'); return; }
        if (!(outQty > 0)) { toast('Enter the quantity after processing.', 'error'); return; }
        payload.process = true;
        payload.output_product_id = out.product_id;
        payload.output_variant_id = Number(out.variant_id) || null;
        payload.output_quantity = outQty;
        payload.costs = PROC_COSTS.filter(c => Number(c.amount) > 0).map(c => ({ activity: (c.activity || '').trim(), amount: Number(c.amount) }));
    }
    const res = await API.post('store.php', payload);
    if (!res.success) { toast(res.message, 'error'); return; }
    closeModal('transferModal');
    afterChange(res.message, 'transfers');
}

async function submitAdjustment(e) {
    e.preventDefault();
    const item = pickItemOrWarn('aj-item');
    if (!item) return;
    const res = await API.post('store.php', {
        action: 'adjustment', product_id: item.product_id, variant_id: Number(item.variant_id) || null,
        location: document.getElementById('aj-location').value,
        direction: document.getElementById('aj-direction').value,
        quantity: document.getElementById('aj-qty').value,
        reason: document.getElementById('aj-reason').value.trim(),
        note: document.getElementById('aj-note').value.trim(),
    });
    if (!res.success) { toast(res.message, 'error'); return; }
    closeModal('adjustModal');
    afterChange(res.message, 'adjustments');
}

async function transferAction(id, action) {
    const ask = {
        approve: 'Approve this transfer?',
        complete: 'Complete this transfer? The stock will move between the two locations now.',
        cancel: 'Cancel this transfer? If it was already completed, the stock goes back to where it came from.',
    }[action];
    if (!confirm(ask)) return;
    const res = await API.put('store.php', { action, id });
    if (!res.success) { toast(res.message, 'error'); return; }
    afterChange(res.message);
}

/* =========================================================
   FARM PURCHASE - many products, shared expenses recorded once
   ========================================================= */
let PU_ITEMS = [];
let PU_EXPS = [];
const EXP_CATS = [['transport', 'Transportation'], ['tax', 'Taxes & levies'], ['storage', 'Store keeping fees'], ['loading', 'Loading / offloading'], ['other', 'Other administrative']];
const EXP_LABEL = Object.fromEntries(EXP_CATS);

function unitOf(label) { const i = findItem(label); return i ? i.unit : ''; }
function lineTotalOf(r) { return (Number(r.qty) || 0) * (Number(r.price) || 0); }

function openPurchaseModal() {
    document.getElementById('purchaseForm').reset();
    PU_ITEMS = [{ label: '', qty: '', price: '' }];
    PU_EXPS = [{ category: 'transport', desc: '', amount: '' }];
    renderPurchaseRows();
    renderExpenseRows();
    updatePurchasePreview();
    openModal('purchaseModal');
}

function renderPurchaseRows() {
    document.getElementById('pu-items').innerHTML = PU_ITEMS.map((r, i) => `
      <div class="pu-row">
        <input type="text" list="itemOptions" value="${esc(r.label)}" placeholder="Type a product..." autocomplete="off" oninput="puItem(${i}, 'label', this.value)" onchange="puItem(${i}, 'label', this.value)">
        <input type="number" min="0.001" step="any" inputmode="decimal" value="${esc(r.qty)}" placeholder="Qty" oninput="puItem(${i}, 'qty', this.value)">
        <span class="muted" id="pu-un-${i}">${esc(unitOf(r.label))}</span>
        <input type="number" min="0" step="any" inputmode="decimal" value="${esc(r.price)}" placeholder="TZS" oninput="puItem(${i}, 'price', this.value)">
        <span class="pu-line" id="pu-lt-${i}">${lineTotalOf(r) ? money(lineTotalOf(r)) : '—'}</span>
        ${PU_ITEMS.length > 1 ? `<button type="button" class="pu-x" title="Remove" onclick="removePurchaseRow(${i})">×</button>` : '<span></span>'}
      </div>`).join('');
}
function addPurchaseRow() { PU_ITEMS.push({ label: '', qty: '', price: '' }); renderPurchaseRows(); updatePurchasePreview(); }
function removePurchaseRow(i) { PU_ITEMS.splice(i, 1); renderPurchaseRows(); updatePurchasePreview(); }
function puItem(i, field, val) {
    PU_ITEMS[i][field] = val;
    if (field === 'label') document.getElementById('pu-un-' + i).textContent = unitOf(val);
    document.getElementById('pu-lt-' + i).textContent = lineTotalOf(PU_ITEMS[i]) ? money(lineTotalOf(PU_ITEMS[i])) : '—';
    updatePurchasePreview();
}

function renderExpenseRows() {
    document.getElementById('pu-exps').innerHTML = PU_EXPS.map((r, i) => `
      <div class="pu-row pu-exp">
        <select onchange="puExp(${i}, 'category', this.value)">${EXP_CATS.map(c => `<option value="${c[0]}" ${r.category === c[0] ? 'selected' : ''}>${c[1]}</option>`).join('')}</select>
        <input type="text" maxlength="150" value="${esc(r.desc)}" placeholder="Details (optional)" oninput="puExp(${i}, 'desc', this.value)">
        <input type="number" min="0" step="any" inputmode="decimal" value="${esc(r.amount)}" placeholder="Amount (TZS)" oninput="puExp(${i}, 'amount', this.value)">
        <button type="button" class="pu-x" title="Remove" onclick="removeExpenseRow(${i})">×</button>
      </div>`).join('');
}
function addExpenseRow() { PU_EXPS.push({ category: 'other', desc: '', amount: '' }); renderExpenseRows(); updatePurchasePreview(); }
function removeExpenseRow(i) { PU_EXPS.splice(i, 1); renderExpenseRows(); updatePurchasePreview(); }
function puExp(i, field, val) { PU_EXPS[i][field] = val; updatePurchasePreview(); }

// Same rule as the server: shared expenses are spread by purchase value or quantity; the last product takes the rounding rest.
function allocateShared(lines, adminTotal, transportTotal, method) {
    const r2 = x => Math.round(x * 100) / 100;
    let weights = lines.map(l => method === 'quantity' ? l.qty : l.total);
    let sum = weights.reduce((a, b) => a + b, 0);
    if (sum <= 0) { weights = lines.map(l => l.qty); sum = weights.reduce((a, b) => a + b, 0); }
    let remA = r2(adminTotal), remT = r2(transportTotal);
    return lines.map((_, i) => {
        if (i === lines.length - 1) return { admin: remA, transport: remT };
        const a = r2(adminTotal * weights[i] / sum), t = r2(transportTotal * weights[i] / sum);
        remA = r2(remA - a); remT = r2(remT - t);
        return { admin: a, transport: t };
    });
}

function purchaseLines() {
    return PU_ITEMS.map(r => ({ r, item: findItem(r.label), qty: Number(r.qty), price: Number(r.price) }))
        .filter(l => l.item && l.qty > 0 && l.r.price !== '' && l.price >= 0)
        .map(l => ({ ...l, total: Math.round(l.qty * l.price * 100) / 100 }));
}

function updatePurchasePreview() {
    let admin = 0, transport = 0;
    PU_EXPS.forEach(e => { const a = Number(e.amount) || 0; if (a > 0) { if (e.category === 'transport') transport += a; else admin += a; } });
    document.getElementById('pu-exp-total').textContent = money(admin + transport);

    const lines = purchaseLines();
    const box = document.getElementById('pu-preview');
    if (!lines.length) { box.innerHTML = '<p class="muted" style="margin:0;">Add a product with its quantity and price to see its actual cost.</p>'; return; }
    const alloc = allocateShared(lines, admin, transport, document.getElementById('pu-method').value);
    let tp = 0, ts = 0, tl = 0;
    const body = lines.map((l, i) => {
        const shared = alloc[i].admin + alloc[i].transport;
        const landed = l.total + shared;
        tp += l.total; ts += shared; tl += landed;
        return `<tr>
          <td><strong>${esc(l.item.label)}</strong><span class="cell-sub">${fmtQty(l.qty)} ${esc(l.item.unit)} × ${money(l.price)}</span></td>
          <td>${money(l.total)}</td>
          <td>${money(shared)}<span class="cell-sub">Transport ${money(alloc[i].transport)} · Other ${money(alloc[i].admin)}</span></td>
          <td><strong>${money(landed)}</strong></td>
          <td><strong>${moneyD(landed / l.qty)}</strong> <span class="muted">/ ${esc(l.item.unit)}</span></td>
        </tr>`;
    }).join('');
    box.innerHTML = tableHtml(['Product', 'Purchase cost', 'Shared expenses', 'Total cost', 'Actual cost per unit'], body +
        `<tr><td><strong>All products</strong></td><td><strong>${money(tp)}</strong></td><td><strong>${money(ts)}</strong></td><td><strong>${money(tl)}</strong></td><td></td></tr>`);
}

async function submitPurchase(e) {
    e.preventDefault();
    const items = [];
    for (let i = 0; i < PU_ITEMS.length; i++) {
        const r = PU_ITEMS[i];
        if (!r.label && !r.qty && r.price === '') continue; // untouched row
        const item = findItem(r.label);
        if (!item) { toast('Row ' + (i + 1) + ': choose a product from the list.', 'error'); return; }
        if (!(Number(r.qty) > 0)) { toast('Row ' + (i + 1) + ': enter the quantity.', 'error'); return; }
        if (r.price === '' || Number(r.price) < 0) { toast('Row ' + (i + 1) + ': enter the price per unit.', 'error'); return; }
        items.push({ product_id: item.product_id, variant_id: Number(item.variant_id) || null, quantity: Number(r.qty), unit_price: Number(r.price) });
    }
    if (!items.length) { toast('Add at least one product.', 'error'); return; }
    const res = await API.post('store.php', {
        action: 'purchase', items,
        expenses: PU_EXPS.filter(x => Number(x.amount) > 0).map(x => ({ category: x.category, description: x.desc.trim(), amount: Number(x.amount) })),
        allocation_method: document.getElementById('pu-method').value,
        farm_name: document.getElementById('pu-farm').value.trim(),
        reference_no: document.getElementById('pu-ref').value.trim(),
        note: document.getElementById('pu-note').value.trim(),
    });
    if (!res.success) { toast(res.message, 'error'); return; }
    closeModal('purchaseModal');
    COST_VIEW = 'purchases';
    afterChange(res.message, isAdmin() ? 'costing' : 'overview'); // the Costing reports are for admins
}

async function openPurchaseDetail(id) {
    const res = await API.get('store.php', { view: 'purchase', id });
    if (!res.success) { toast(res.message, 'error'); return; }
    const { purchase: p, items, expenses } = res.data;
    document.getElementById('pd-title').textContent = p.ref + (p.status === 'cancelled' ? ' (cancelled)' : '');
    const rows = items.map(i => `<tr>
        <td><strong>${esc(i.product_name)}</strong></td>
        <td>${fmtQty(i.quantity)} <span class="muted">${esc(i.unit)}</span></td>
        <td>${money(i.unit_price)}</td>
        <td>${money(i.purchase_total)}</td>
        <td>${money(i.alloc_admin)}</td>
        <td>${money(i.alloc_transport)}</td>
        <td><strong>${money(i.landed_total)}</strong></td>
        <td><strong>${moneyD(i.landed_unit_cost)}</strong></td>
      </tr>`).join('');
    const exp = expenses.length ? expenses.map(x => `<tr><td>${esc(EXP_LABEL[x.category] || x.category)}</td><td class="muted">${esc(x.description || '')}</td><td>${money(x.amount)}</td></tr>`).join('') : emptyRow(3, 'No shared expenses.');
    document.getElementById('pd-body').innerHTML = `
      <p class="muted" style="margin-top:0;">${esc(fmtDateText(p.received_at))} · ${esc(p.farm_name || 'No supplier given')}${p.reference_no ? ' · ' + esc(p.reference_no) : ''} · by ${esc(p.staff || '—')}<br>Shared expenses were spread ${p.allocation_method === 'quantity' ? 'by quantity' : 'by purchase value'}.</p>
      ${tableHtml(['Product', 'Quantity', 'Price / unit', 'Purchase cost', 'Admin share', 'Transport share', 'Total cost', 'Cost / unit'], rows +
        `<tr><td colspan="3"><strong>Total</strong></td><td><strong>${money(p.purchase_total)}</strong></td><td><strong>${money(p.admin_total)}</strong></td><td><strong>${money(p.transport_total)}</strong></td><td><strong>${money(p.landed_total)}</strong></td><td></td></tr>`)}
      <div class="store-section-title" style="margin-top:16px;">Shared expenses (recorded once)</div>
      ${tableHtml(['Type', 'Details', 'Amount'], exp)}`;
    openModal('purchaseDetailModal');
}
function fmtDateText(ts) { return ts ? String(ts).slice(0, 16).replace('T', ' ') : ''; }

async function cancelPurchase(id) {
    if (!confirm('Cancel this farm purchase? All its products are taken out of the Main Store again.')) return;
    const res = await API.put('store.php', { action: 'cancel_purchase', id });
    if (!res.success) { toast(res.message, 'error'); return; }
    afterChange(res.message);
}

/* =========================================================
   PROCESSING on the way to the shop (transfer form)
   ========================================================= */
let PROC_COSTS = [];

function processOn() {
    return document.getElementById('tr-process').checked && document.getElementById('tr-direction').value === 'store>pos';
}
function syncProcessBox() {
    const wrap = document.getElementById('tr-process-wrap');
    const storeToShop = document.getElementById('tr-direction').value === 'store>pos';
    wrap.style.display = storeToShop ? '' : 'none';
    if (!storeToShop) document.getElementById('tr-process').checked = false;
    const on = processOn();
    document.getElementById('tr-process-box').style.display = on ? '' : 'none';
    if (on && !PROC_COSTS.length) PROC_COSTS = [{ activity: 'Milling (kukoboa)', amount: '' }];
    if (!on) PROC_COSTS = [];
    renderProcCosts();
    updateLoss();
}
function renderProcCosts() {
    document.getElementById('tr-costs').innerHTML = PROC_COSTS.map((c, i) => `
      <div class="pu-row" style="grid-template-columns:2fr 1.2fr 32px;">
        <input type="text" list="procActivities" maxlength="150" value="${esc(c.activity)}" placeholder="Activity" oninput="procChange(${i}, 'activity', this.value)">
        <input type="number" min="0" step="any" inputmode="decimal" value="${esc(c.amount)}" placeholder="Cost (TZS)" oninput="procChange(${i}, 'amount', this.value)">
        <button type="button" class="pu-x" title="Remove" onclick="removeProcCost(${i})">×</button>
      </div>`).join('');
    updateProcTotal();
}
function addProcCostRow() { PROC_COSTS.push({ activity: '', amount: '' }); renderProcCosts(); }
function removeProcCost(i) { PROC_COSTS.splice(i, 1); renderProcCosts(); }
function procChange(i, f, v) { PROC_COSTS[i][f] = v; updateProcTotal(); }
function updateProcTotal() {
    document.getElementById('tr-proc-total').textContent = money(PROC_COSTS.reduce((a, c) => a + (Number(c.amount) > 0 ? Number(c.amount) : 0), 0));
}
function updateLoss() {
    const box = document.getElementById('tr-loss');
    const inItem = findItem(document.getElementById('tr-item').value);
    const outItem = findItem(document.getElementById('tr-out-item').value);
    const qin = Number(document.getElementById('tr-qty').value);
    const qout = Number(document.getElementById('tr-out-qty').value);
    if (!processOn() || !inItem || !outItem || !(qin > 0) || !(qout > 0)) { box.style.display = 'none'; return; }
    box.style.display = '';
    if (inItem.unit !== outItem.unit) { box.textContent = 'The units differ (' + inItem.unit + ' → ' + outItem.unit + '), so the loss is not calculated.'; return; }
    const loss = roundQty(qin - qout);
    if (loss < 0) box.innerHTML = '<span class="qty-out">The finished quantity is more than the quantity used.</span>';
    else box.innerHTML = 'Processing loss: <strong>' + fmtQty(loss) + '</strong> ' + esc(inItem.unit) + ' (' + (Math.round(loss / qin * 1000) / 10) + '%)';
}

/* =========================================================
   COSTING tab (admin)
   ========================================================= */
function setCostView(v) { COST_VIEW = v; setTab('costing'); }
function costNav() {
    return '<div class="store-subnav no-print">' + [['purchases', 'Purchases'], ['stock', 'Stock Value'], ['processing', 'Processing'], ['history', 'Cost History']]
        .map(([k, l]) => `<button type="button" class="store-chip ${COST_VIEW === k ? 'active' : ''}" onclick="setCostView('${k}')">${l}</button>`).join('') + '</div>';
}
function renderCosting(data) {
    ({ purchases: renderPurchases, stock: renderValuation, processing: renderProcessing, history: renderCostHistory })[COST_VIEW](data);
}

function renderPurchases(data) {
    setPrintInfo(data.range);
    const t = data.totals;
    const body = data.rows.length ? data.rows.map(r => `
      <tr class="${r.status === 'cancelled' ? 'row-cancelled' : ''}">
        <td>${fmtDT(r.received_at)}<span class="cell-sub">${esc(r.ref)}${r.farm_name ? ' · ' + esc(r.farm_name) : ''} · ${esc(r.staff || '—')}</span></td>
        <td>${esc(r.product_names || '—')}<span class="cell-sub">${r.item_count} product${Number(r.item_count) === 1 ? '' : 's'}${r.status === 'cancelled' ? ' · cancelled' : ''}</span></td>
        <td>${money(r.purchase_total)}</td>
        <td>${money(Number(r.admin_total) + Number(r.transport_total))}<span class="cell-sub">Transport ${money(r.transport_total)} · Other ${money(r.admin_total)}</span></td>
        <td><strong>${money(r.landed_total)}</strong></td>
        <td class="no-print"><div class="store-actions"><button class="btn btn-outline btn-sm" onclick="openPurchaseDetail(${r.id})">Details</button>${r.status === 'active' ? `<button class="btn btn-outline btn-sm" onclick="cancelPurchase(${r.id})">Cancel</button>` : ''}</div></td>
      </tr>`).join('') : emptyRow(6, 'No farm purchases for this selection.');

    setContent(costNav() +
        statCards([['Purchase cost', money(t.purchase_total)], ['Shared expenses', money(Number(t.admin_total) + Number(t.transport_total)), 'gold'], ['Total cost (landed)', money(t.landed_total), 'green']]) +
        `<div class="card"><div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))}</span><button class="btn btn-primary btn-sm" onclick="openPurchaseModal()">+ New Farm Purchase</button></div>
        ${tableHtml(['When / Ref', 'Products', 'Purchase cost', 'Shared expenses', 'Total cost', '<span class="no-print"></span>'], body)}${truncNote(data.truncated)}</div>`);

    LAST_EXPORT = {
        name: 'Farm_Purchases',
        headers: ['Ref', 'Date & Time', 'Farm / Supplier', 'Products', 'Purchase Cost', 'Transport', 'Other Shared Expenses', 'Total Cost', 'Status', 'Recorded By'],
        rows: data.rows.map(r => [r.ref, plainDT(r.received_at), r.farm_name || '', r.product_names || '', r.purchase_total, r.transport_total, r.admin_total, r.landed_total, r.status, r.staff || '']),
    };
}

function renderValuation(data) {
    setPrintInfo(null);
    const loc = document.getElementById('fLocation').value;
    const showStore = loc !== 'pos', showPos = loc !== 'store';
    const side = (qty, cost, value, est, unit) => `${qtyCell(qty, unit, false)}<span class="cell-sub">${moneyD(cost)} / unit${est ? ' ~' : ''} · ${money(value)}</span>`;
    const body = data.rows.length ? data.rows.map(r => {
        const p = splitLabel({ ...r, label: r.label });
        const margin = Number(r.margin);
        return `<tr>
          <td><strong>${esc(p.name)}</strong></td>
          <td>${p.type ? esc(p.type) : '<span class="muted">—</span>'}</td>
          ${showStore ? `<td>${side(r.store_qty, r.store_cost, r.store_value, r.store_estimated, r.unit)}</td>` : ''}
          ${showPos ? `<td>${side(r.pos_qty, r.pos_cost, r.pos_value, r.pos_estimated, r.unit)}</td>
          <td>${moneyD(r.selling_price)}</td>
          <td class="${margin < 0 ? 'cost-up' : 'cost-down'}">${moneyD(margin)}</td>` : ''}
        </tr>`;
    }).join('') : emptyRow(8, 'No stock to value.');

    const heads = ['Product', 'Type'];
    if (showStore) heads.push('Main Store (qty · cost · value)');
    if (showPos) heads.push('POS / Shop (qty · cost · value)', 'Selling price', 'Margin / unit');
    const cards = [];
    if (showStore) cards.push(['Main Store stock value', money(data.totals.store_value), 'gold']);
    if (showPos) cards.push(['POS / Shop stock value', money(data.totals.pos_value), 'green']);
    if (showStore && showPos) cards.push(['Total stock value', money(data.totals.store_value + data.totals.pos_value)]);

    setContent(costNav() + statCards(cards) +
        `<div class="card"><div class="store-toolbar no-print"><span class="muted">Stock valued at its actual cost today. "~" = no cost recorded yet, so the buying price is used.</span></div>
        ${tableHtml(heads, body)}</div>`);

    LAST_EXPORT = {
        name: 'Stock_Value',
        headers: ['Product', 'Type', 'Unit', 'Main Store Qty', 'Main Store Cost/Unit', 'Main Store Value', 'POS Qty', 'POS Cost/Unit', 'POS Value', 'Selling Price', 'Margin/Unit'],
        rows: data.rows.map(r => { const p = splitLabel(r); return [p.name, p.type, r.unit, r.store_qty, r.store_cost, r.store_value, r.pos_qty, r.pos_cost, r.pos_value, r.selling_price, r.margin]; }),
    };
}

function renderProcessing(data) {
    setPrintInfo(data.range);
    const t = data.totals;
    const body = data.rows.length ? data.rows.map(r => {
        const outQty = r.output_quantity !== null ? Number(r.output_quantity) : Number(r.quantity);
        const to = r.output_name || r.product_name;
        const toUnit = r.output_unit || r.unit;
        const loss = r.loss_qty !== null && r.loss_qty !== undefined ? ' · loss ' + fmtQty(r.loss_qty) + ' ' + esc(r.unit) : '';
        const lines = (r.costs || []).map(c => esc(c.activity) + ' ' + money(c.amount)).join(', ');
        return `<tr>
          <td>${fmtDT(r.completed_at)}<span class="cell-sub">${esc(r.ref)} · ${esc(r.staff || '—')}</span></td>
          <td><strong>${esc(r.product_name)}</strong> <span class="muted">${fmtQty(r.quantity)} ${esc(r.unit)}</span>
              <span class="cell-sub">→ ${esc(to)} ${fmtQty(outQty)} ${esc(toUnit)}${loss} · ${esc(LOCATION_LABEL[r.source])} → ${esc(LOCATION_LABEL[r.destination])}</span></td>
          <td><div class="cost-break">Stock <strong>${money(r.input_cost)}</strong> + Processing <strong>${money(r.processing_cost)}</strong> = <strong>${money(r.total_cost)}</strong>${lines ? '<br>' + lines : ''}</div></td>
          <td><strong>${moneyD(r.output_unit_cost)}</strong> <span class="muted">/ ${esc(toUnit)}</span></td>
        </tr>`;
    }).join('') : emptyRow(4, 'No costed transfers for this selection.');

    setContent(costNav() +
        statCards([['Stock cost moved to shop', money(t.input_cost)], ['Processing cost', money(t.processing_cost), 'gold'], ['Total cost moved to shop', money(t.total_cost), 'green']]) +
        `<div class="card"><div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))}</span><button class="btn btn-primary btn-sm" onclick="openTransferModal()">+ Transfer Stock</button></div>
        ${tableHtml(['When / Ref', 'Stock moved', 'Cost', 'Final cost per unit'], body)}${truncNote(data.truncated)}</div>`);

    LAST_EXPORT = {
        name: 'Transfer_Costs',
        headers: ['Ref', 'Date & Time', 'From Product', 'Qty Used', 'Unit', 'To Product', 'Qty After', 'Unit', 'Loss', 'Stock Cost', 'Processing Cost', 'Total Cost', 'Final Cost/Unit', 'Processing Details'],
        rows: data.rows.map(r => [r.ref, plainDT(r.completed_at), r.product_name, fmtQty(r.quantity), r.unit, r.output_name || r.product_name,
            fmtQty(r.output_quantity !== null ? r.output_quantity : r.quantity), r.output_unit || r.unit, r.loss_qty !== null && r.loss_qty !== undefined ? fmtQty(r.loss_qty) : '',
            r.input_cost, r.processing_cost, r.total_cost, r.output_unit_cost, (r.costs || []).map(c => c.activity + ' ' + c.amount).join('; ')]),
    };
}

function renderCostHistory(data) {
    setPrintInfo(data.range);
    const body = data.rows.length ? data.rows.map(r => {
        const pct = r.change_pct;
        const change = pct === null ? '<span class="muted">first record</span>'
            : (pct > 0 ? `<span class="cost-up">▲ ${pct}%</span>` : pct < 0 ? `<span class="cost-down">▼ ${Math.abs(pct)}%</span>` : '<span class="muted">no change</span>');
        return `<tr>
          <td>${fmtDT(r.ts)}<span class="cell-sub">${esc(r.ref)}</span></td>
          <td><strong>${esc(r.product_name)}</strong></td>
          <td>${r.kind === 'purchase' ? 'Farm purchase' : 'Processed for the shop'}</td>
          <td>${fmtQty(r.qty)} <span class="muted">${esc(r.unit)}</span></td>
          <td><strong>${moneyD(r.unit_cost)}</strong>${r.previous_cost !== null ? `<span class="cell-sub">was ${moneyD(r.previous_cost)}</span>` : ''}</td>
          <td>${change}</td>
        </tr>`;
    }).join('') : emptyRow(6, 'No cost records for this selection.');

    setContent(costNav() + `<div class="card"><div class="store-toolbar no-print"><span class="muted">${esc(rangeText(data.range))} · Cost per unit of every batch that came in, and how it changed.</span></div>
        ${tableHtml(['When / Ref', 'Product', 'Source', 'Quantity', 'Cost per unit', 'Change'], body)}${truncNote(data.truncated)}</div>`);

    LAST_EXPORT = {
        name: 'Cost_History',
        headers: ['Date & Time', 'Ref', 'Product', 'Source', 'Quantity', 'Unit', 'Cost/Unit', 'Previous Cost/Unit', 'Change %'],
        rows: data.rows.map(r => [plainDT(r.ts), r.ref, r.product_name, r.kind === 'purchase' ? 'Farm purchase' : 'Processed', fmtQty(r.qty), r.unit, r.unit_cost, r.previous_cost === null ? '' : r.previous_cost, r.change_pct === null ? '' : r.change_pct]),
    };
}
