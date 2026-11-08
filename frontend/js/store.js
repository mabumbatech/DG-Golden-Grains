/**
 * GOLDEN GRAINS - Store Management
 * Farm -> Main Store (warehouse) -> POS / Shop
 * Tabs: Stock Overview, Farm Receipts, Stock Transfers, Damages, Adjustments, Movement History, Reports
 */
let TAB = 'overview';
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
    adjustments: 'Stock Adjustments', movements: 'Inventory Movement History', report: 'Inventory Report',
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
const LOCATION_FILTER_LABEL = { transfers: 'Source or destination', damages: 'Location of damage' };

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
    ['rc-item', 'tr-item', 'aj-item'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', () => updateHint(id));
        el.addEventListener('change', () => updateHint(id));
    });
    document.getElementById('tr-direction').addEventListener('change', () => updateHint('tr-item'));
    document.getElementById('aj-location').addEventListener('change', () => updateHint('aj-item'));
    document.getElementById('receiptForm').addEventListener('submit', submitReceipt);
    document.getElementById('transferForm').addEventListener('submit', submitTransfer);
    document.getElementById('adjustForm').addEventListener('submit', submitAdjustment);
    const wanted = (location.hash || '').replace('#', '');
    setTab(TAB_TITLE[wanted] ? wanted : 'overview');
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
    const uses = TAB_FILTERS[tab];
    card.classList.toggle('hidden', !uses);
    if (uses) {
        ['product', 'staff', 'location', 'type', 'status'].forEach(f => {
            const el = card.querySelector('[data-f="' + f + '"]');
            if (el) el.classList.toggle('hidden', !uses.includes(f));
        });
        document.getElementById('fLocationLabel').textContent = LOCATION_FILTER_LABEL[tab] || 'Location';
        const sel = document.getElementById('fStatus');
        const opts = STATUS_OPTIONS[tab] || [];
        sel.innerHTML = '<option value="">All</option>' + opts.map(o => `<option value="${o[0]}">${o[1]}</option>`).join('');
        syncPresetFields();
    }
    loadTab();
}

function syncPresetFields() {
    const custom = document.getElementById('fPreset').value === 'custom';
    document.querySelectorAll('#filterCard [data-f="custom"]').forEach(el => el.classList.toggle('hidden', !custom));
}

function toggleAdv() {
    const card = document.getElementById('filterCard');
    card.classList.toggle('adv-open');
    document.getElementById('advBtn').textContent = card.classList.contains('adv-open') ? 'Fewer filters' : 'More filters';
}

function resetFilters() {
    document.getElementById('fPreset').value = 'this_month';
    ['fStart', 'fEnd', 'fTimeFrom', 'fTimeTo', 'fProduct', 'fStaff', 'fLocation', 'fType', 'fStatus'].forEach(id => { document.getElementById(id).value = ''; });
    syncPresetFields();
    loadTab();
}

function filterParams() {
    const uses = TAB_FILTERS[TAB] || [];
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
    else res = await API.get('store.php', { view: tab, ...filterParams() });
    if (tab !== TAB) return; // the person switched tab while this was loading
    if (!res.success) { setContent(`<div class="card"><p class="muted">${esc(res.message)}</p></div>`); return; }

    ({
        overview: renderOverview, transfers: renderTransfers, damages: renderDamages,
        adjustments: renderAdjustments, movements: renderMovements, report: renderReport,
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
        <td><strong>${esc(t.product_name)}</strong>${t.note ? '<span class="cell-sub">' + esc(t.note) + '</span>' : ''}</td>
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
    const hint = document.getElementById({ 'rc-item': 'rc-hint', 'tr-item': 'tr-hint', 'aj-item': 'aj-hint' }[inputId]);
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

function openReceiptModal() {
    document.getElementById('receiptForm').reset();
    document.getElementById('rc-hint').classList.add('hidden');
    openModal('receiptModal');
}
function openTransferModal() {
    document.getElementById('transferForm').reset();
    document.getElementById('tr-hint').classList.add('hidden');
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

async function submitReceipt(e) {
    e.preventDefault();
    const item = pickItemOrWarn('rc-item');
    if (!item) return;
    const res = await API.post('store.php', {
        action: 'receipt', product_id: item.product_id, variant_id: Number(item.variant_id) || null,
        quantity: document.getElementById('rc-qty').value,
        farm_name: document.getElementById('rc-farm').value.trim(),
        reference_no: document.getElementById('rc-ref').value.trim(),
        note: document.getElementById('rc-note').value.trim(),
    });
    if (!res.success) { toast(res.message, 'error'); return; }
    closeModal('receiptModal');
    afterChange(res.message, 'overview');
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
    const res = await API.post('store.php', {
        action: 'transfer', product_id: item.product_id, variant_id: Number(item.variant_id) || null,
        source, destination, quantity: qty,
        note: document.getElementById('tr-note').value.trim(),
        status: document.getElementById('tr-pending').checked ? 'pending' : 'completed',
    });
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
