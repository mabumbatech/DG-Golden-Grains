<?php
/**
 * GOLDEN GRAINS - Store Management API
 *
 * Farm -> Main Store (warehouse) -> POS / Shop
 *
 * GET  ?view=meta         staff + items for the pickers
 *      ?view=overview     main-store and POS/shop stock side by side
 *      ?view=receipts     farm-to-store receipts
 *      ?view=transfers    store <-> POS transfers
 *      ?view=adjustments  manual stock adjustments
 *      ?view=movements    complete inventory movement history
 *      ?view=report       inventory report (totals per product + movement history)
 *      (damage records come from damages.php, which has the same filters)
 * POST action=receipt | transfer | adjustment
 * PUT  action=approve | complete | cancel (transfers)   action=cancel_receipt
 *
 * Common filters: preset (today, yesterday, this_week, last_week, this_month, last_month, custom, all),
 *                 start, end, time_from, time_to, product_id, user_id, location, type, status
 */
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/audit_helper.php';
require_once __DIR__ . '/../helpers/access_helper.php';
require_once __DIR__ . '/../helpers/store_helper.php';

$user = require_login();
$pdo = get_db();
ensure_store_schema($pdo);
$method = $_SERVER['REQUEST_METHOD'];

const LIST_LIMIT = 500;

function ref_code(string $prefix, $id): string
{
    return $prefix . '-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT);
}

/** Processing / preparation expense lines of the given transfers, grouped by transfer id. */
function transfer_cost_lines(PDO $pdo, array $ids): array
{
    if (!$ids) return [];
    $in = implode(',', array_map('intval', $ids));
    $out = [];
    foreach ($pdo->query("SELECT transfer_id, activity, amount FROM stock_transfer_costs WHERE transfer_id IN ($in) ORDER BY id")->fetchAll() as $c) {
        $out[$c['transfer_id']][] = ['activity' => $c['activity'], 'amount' => (float)$c['amount']];
    }
    return $out;
}

/** "PUR-00012" / "TRF-3" -> 12 / 3 (null when $q is not a reference of that kind). */
function id_from_ref(string $prefix, string $q): ?int
{
    return preg_match('/^' . $prefix . '-?0*(\d+)$/i', trim($q), $m) ? (int)$m[1] : null;
}

/** SQL for a product name that includes the type, e.g. "Rice — Kyela 25kg". */
const ITEM_NAME_SQL = "CASE WHEN pv.id IS NOT NULL THEN CONCAT(p.name, ' — ', pv.variant_name) ELSE p.name END";

/* =========================================================
   GET
   ========================================================= */
if ($method === 'GET') {
    $view = clean($_GET['view'] ?? 'overview');

    if ($view === 'meta') {
        $staff = $pdo->query("SELECT id, full_name FROM users WHERE status = 'active' ORDER BY full_name ASC")->fetchAll();
        $items = $pdo->query('SELECT * FROM (' . stock_items_sql(true) . ') x ORDER BY label ASC')->fetchAll();
        if (!is_admin_user($user)) $items = array_map(fn($r) => strip_cost_fields($r, ['buying_price', 'selling_price']), $items);
        $products = $pdo->query("SELECT id, name FROM products WHERE status = 'active' ORDER BY name ASC")->fetchAll();
        respond(true, ['staff' => $staff, 'items' => $items, 'products' => $products, 'is_admin' => is_admin_user($user)]);
    }

    if ($view === 'overview') {
        $where = '';
        $params = [];
        if (!empty($_GET['q'])) { $where = ' WHERE label LIKE ?'; $params[] = '%' . clean($_GET['q']) . '%'; }
        $stmt = $pdo->prepare('SELECT * FROM (' . stock_items_sql(false) . ') x' . $where . ' ORDER BY label ASC');
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        if (!is_admin_user($user)) $rows = array_map(fn($r) => strip_cost_fields($r, ['buying_price', 'selling_price']), $rows);
        $totals = ['store_qty' => 0, 'pos_qty' => 0];
        foreach ($rows as $r) {
            $totals['store_qty'] += (float)$r['store_qty'];
            $totals['pos_qty'] += (float)$r['pos_qty'];
        }
        respond(true, ['rows' => $rows, 'totals' => $totals]);
    }


    /* ---------- COSTING (admin only) ---------- */
    if (in_array($view, ['purchases', 'purchase', 'valuation', 'processing', 'cost_history'], true)) {
        require_role(['admin']);
        $range = store_range($pdo, $_GET);

        /* one purchasing transaction with its products and shared expenses */
        if ($view === 'purchase') {
            $id = (int)($_GET['id'] ?? 0);
            $h = $pdo->prepare('SELECT fp.*, u.full_name AS staff FROM farm_purchases fp LEFT JOIN users u ON u.id = fp.received_by WHERE fp.id = ?');
            $h->execute([$id]);
            $head = $h->fetch();
            if (!$head) respond(false, null, 'Purchase not found.', 404);
            $head['ref'] = ref_code('PUR', $head['id']);
            $it = $pdo->prepare("SELECT fi.*, " . ITEM_NAME_SQL . " AS product_name, COALESCE(fi.unit, pv.unit, p.unit) AS unit
                FROM farm_purchase_items fi JOIN products p ON p.id = fi.product_id LEFT JOIN product_variants pv ON pv.id = fi.variant_id
                WHERE fi.purchase_id = ? ORDER BY fi.id");
            $it->execute([$id]);
            $ex = $pdo->prepare('SELECT category, description, amount FROM farm_purchase_expenses WHERE purchase_id = ? ORDER BY id');
            $ex->execute([$id]);
            respond(true, ['purchase' => $head, 'items' => $it->fetchAll(), 'expenses' => $ex->fetchAll()]);
        }

        /* purchasing transactions */
        if ($view === 'purchases') {
            $params = [];
            $where = 'WHERE 1=1' . store_range_sql('fp.received_at', $range, $params);
            if (!empty($_GET['product_id'])) { $where .= ' AND EXISTS (SELECT 1 FROM farm_purchase_items x WHERE x.purchase_id = fp.id AND x.product_id = ?)'; $params[] = (int)$_GET['product_id']; }
            if (!empty($_GET['user_id']))    { $where .= ' AND fp.received_by = ?'; $params[] = (int)$_GET['user_id']; }
            if (!empty($_GET['ref'])) {
                $rid = id_from_ref('PUR', (string)$_GET['ref']);
                if ($rid) { $where .= ' AND fp.id = ?'; $params[] = $rid; }
                else { $where .= ' AND (fp.farm_name LIKE ? OR fp.reference_no LIKE ?)'; $params[] = '%' . clean($_GET['ref']) . '%'; $params[] = '%' . clean($_GET['ref']) . '%'; }
            }
            $stmt = $pdo->prepare("SELECT fp.*, u.full_name AS staff,
                    (SELECT COUNT(*) FROM farm_purchase_items i WHERE i.purchase_id = fp.id) AS item_count,
                    (SELECT GROUP_CONCAT(CASE WHEN iv.id IS NOT NULL THEN CONCAT(ip.name, ' — ', iv.variant_name) ELSE ip.name END SEPARATOR ', ')
                       FROM farm_purchase_items i JOIN products ip ON ip.id = i.product_id LEFT JOIN product_variants iv ON iv.id = i.variant_id WHERE i.purchase_id = fp.id) AS product_names
                FROM farm_purchases fp LEFT JOIN users u ON u.id = fp.received_by
                $where ORDER BY fp.received_at DESC, fp.id DESC LIMIT " . (LIST_LIMIT + 1));
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
            $truncated = count($rows) > LIST_LIMIT;
            $rows = array_slice($rows, 0, LIST_LIMIT);
            $tot = ['purchase_total' => 0, 'admin_total' => 0, 'transport_total' => 0, 'landed_total' => 0];
            foreach ($rows as &$r) {
                $r['ref'] = ref_code('PUR', $r['id']);
                if ($r['status'] === 'active') foreach ($tot as $k => $_) $tot[$k] += (float)$r[$k];
            }
            unset($r);
            respond(true, ['rows' => $rows, 'totals' => array_map(fn($v) => round($v, 2), $tot), 'range' => $range, 'truncated' => $truncated]);
        }

        /* stock valuation: quantity x actual cost, per location */
        if ($view === 'valuation') {
            $costs = [];
            foreach ($pdo->query('SELECT location, product_id, variant_id, unit_cost FROM stock_costs')->fetchAll() as $c) {
                $costs[$c['location'] . '-' . $c['product_id'] . '-' . $c['variant_id']] = (float)$c['unit_cost'];
            }
            $items = $pdo->query('SELECT * FROM (' . stock_items_sql(false) . ') x ORDER BY label ASC')->fetchAll();
            $filterProduct = !empty($_GET['product_id']) ? (int)$_GET['product_id'] : 0;
            $rows = [];
            $totals = ['store_value' => 0, 'pos_value' => 0];
            foreach ($items as $it) {
                if ($filterProduct && (int)$it['product_id'] !== $filterProduct) continue;
                if (!(float)$it['store_qty'] && !(float)$it['pos_qty']) continue;
                $key = $it['product_id'] . '-' . $it['variant_id'];
                $sc = $costs['store-' . $key] ?? null;
                $pc = $costs['pos-' . $key] ?? null;
                $storeCost = $sc !== null ? $sc : (float)$it['buying_price'];
                $posCost = $pc !== null ? $pc : (float)$it['buying_price'];
                $row = [
                    'product_id' => (int)$it['product_id'], 'variant_id' => (int)$it['variant_id'],
                    'label' => $it['label'], 'product_name' => $it['product_name'], 'unit' => $it['unit'],
                    'store_qty' => to_qty($it['store_qty']), 'store_cost' => round($storeCost, 4), 'store_estimated' => $sc === null,
                    'store_value' => round(to_qty($it['store_qty']) * $storeCost, 2),
                    'pos_qty' => to_qty($it['pos_qty']), 'pos_cost' => round($posCost, 4), 'pos_estimated' => $pc === null,
                    'pos_value' => round(to_qty($it['pos_qty']) * $posCost, 2),
                    'selling_price' => (float)$it['selling_price'],
                    'margin' => round((float)$it['selling_price'] - $posCost, 2),
                ];
                $totals['store_value'] += $row['store_value'];
                $totals['pos_value'] += $row['pos_value'];
                $rows[] = $row;
            }
            respond(true, ['rows' => $rows, 'totals' => array_map(fn($v) => round($v, 2), $totals)]);
        }

        /* transfers with their costs (including processing) */
        if ($view === 'processing') {
            $params = [];
            $where = "WHERE t.status = 'completed' AND t.total_cost IS NOT NULL" . store_range_sql('t.completed_at', $range, $params);
            if (!empty($_GET['product_id'])) { $where .= ' AND (t.product_id = ? OR t.output_product_id = ?)'; $params[] = (int)$_GET['product_id']; $params[] = (int)$_GET['product_id']; }
            if (!empty($_GET['location']) && valid_location($_GET['location'])) { $where .= ' AND t.destination = ?'; $params[] = $_GET['location']; }
            if (!empty($_GET['ref'])) {
                $rid = id_from_ref('TRF', (string)$_GET['ref']);
                if ($rid) { $where .= ' AND t.id = ?'; $params[] = $rid; }
            }
            $stmt = $pdo->prepare("SELECT t.*, " . ITEM_NAME_SQL . " AS product_name, COALESCE(pv.unit, p.unit) AS unit,
                    CASE WHEN t.output_product_id IS NULL THEN NULL WHEN ov.id IS NOT NULL THEN CONCAT(op.name, ' — ', ov.variant_name) ELSE op.name END AS output_name,
                    COALESCE(ov.unit, op.unit) AS output_unit, u.full_name AS staff
                FROM stock_transfers t
                JOIN products p ON p.id = t.product_id
                LEFT JOIN product_variants pv ON pv.id = t.variant_id
                LEFT JOIN products op ON op.id = t.output_product_id
                LEFT JOIN product_variants ov ON ov.id = t.output_variant_id
                LEFT JOIN users u ON u.id = COALESCE(t.completed_by, t.created_by)
                $where ORDER BY t.completed_at DESC, t.id DESC LIMIT " . (LIST_LIMIT + 1));
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
            $truncated = count($rows) > LIST_LIMIT;
            $rows = array_slice($rows, 0, LIST_LIMIT);
            $lines = transfer_cost_lines($pdo, array_column($rows, 'id'));
            $tot = ['input_cost' => 0, 'processing_cost' => 0, 'total_cost' => 0];
            foreach ($rows as &$r) {
                $r['ref'] = ref_code('TRF', $r['id']);
                $r['costs'] = $lines[$r['id']] ?? [];
                if ($r['destination'] === 'pos') foreach ($tot as $k => $_) $tot[$k] += (float)$r[$k];
            }
            unset($r);
            respond(true, ['rows' => $rows, 'totals' => array_map(fn($v) => round($v, 2), $tot), 'range' => $range, 'truncated' => $truncated]);
        }

        /* historical cost changes: every purchase and every processed batch, with the change from the previous one */
        if ($view === 'cost_history') {
            $union = "
                SELECT fp.received_at AS ts, 'purchase' AS kind, CONCAT('PUR-', LPAD(fp.id, 5, '0')) AS ref, fi.product_id, COALESCE(fi.variant_id, 0) AS variant_id,
                       fi.quantity AS qty, fi.landed_unit_cost AS unit_cost, fi.unit AS u
                  FROM farm_purchase_items fi JOIN farm_purchases fp ON fp.id = fi.purchase_id WHERE fp.status = 'active'
                UNION ALL
                SELECT t.completed_at, 'processing', CONCAT('TRF-', LPAD(t.id, 5, '0')), COALESCE(t.output_product_id, t.product_id),
                       IF(t.output_product_id IS NULL, COALESCE(t.variant_id, 0), COALESCE(t.output_variant_id, 0)),
                       COALESCE(t.output_quantity, t.quantity), t.output_unit_cost, NULL
                  FROM stock_transfers t
                 WHERE t.status = 'completed' AND t.output_unit_cost IS NOT NULL AND t.destination = 'pos'
                   AND (t.output_product_id IS NOT NULL OR t.processing_cost > 0)";
            $params = [];
            $where = 'WHERE ch.ts IS NOT NULL' . store_range_sql('ch.ts', $range, $params);
            if (!empty($_GET['product_id'])) { $where .= ' AND ch.product_id = ?'; $params[] = (int)$_GET['product_id']; }
            $stmt = $pdo->prepare("SELECT ch.ts, ch.kind, ch.ref, ch.qty, ch.unit_cost, ch.product_id, ch.variant_id,
                    CASE WHEN ch.variant_id > 0 THEN CONCAT(p.name, ' — ', COALESCE(pv.variant_name, 'removed type')) ELSE p.name END AS product_name,
                    COALESCE(ch.u, pv.unit, p.unit) AS unit
                FROM ($union) ch JOIN products p ON p.id = ch.product_id LEFT JOIN product_variants pv ON pv.id = ch.variant_id
                $where ORDER BY ch.ts ASC, ch.ref ASC LIMIT 2000");
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
            $last = [];
            foreach ($rows as &$r) {
                $k = $r['product_id'] . '-' . $r['variant_id'];
                $prev = $last[$k] ?? null;
                $r['previous_cost'] = $prev;
                $r['change_pct'] = ($prev !== null && $prev > 0) ? round(((float)$r['unit_cost'] - $prev) / $prev * 100, 1) : null;
                $last[$k] = (float)$r['unit_cost'];
            }
            unset($r);
            $rows = array_reverse($rows);
            $truncated = count($rows) > LIST_LIMIT;
            respond(true, ['rows' => array_slice($rows, 0, LIST_LIMIT), 'range' => $range, 'truncated' => $truncated]);
        }
    }

    $range = store_range($pdo, $_GET);

    if ($view === 'receipts') {
        $params = [];
        $where = 'WHERE 1=1' . store_range_sql('fr.received_at', $range, $params);
        if (!empty($_GET['product_id'])) { $where .= ' AND fr.product_id = ?'; $params[] = (int)$_GET['product_id']; }
        if (!empty($_GET['user_id']))    { $where .= ' AND fr.received_by = ?'; $params[] = (int)$_GET['user_id']; }
        if (!empty($_GET['status']) && in_array($_GET['status'], ['active', 'cancelled'], true)) { $where .= ' AND fr.status = ?'; $params[] = $_GET['status']; }

        $stmt = $pdo->prepare("SELECT fr.*, " . ITEM_NAME_SQL . " AS product_name, COALESCE(pv.unit, p.unit) AS unit,
                u.full_name AS staff, cu.full_name AS cancelled_by_name
            FROM farm_receipts fr
            JOIN products p ON p.id = fr.product_id
            LEFT JOIN product_variants pv ON pv.id = fr.variant_id
            LEFT JOIN users u ON u.id = fr.received_by
            LEFT JOIN users cu ON cu.id = fr.cancelled_by
            $where ORDER BY fr.received_at DESC, fr.id DESC LIMIT " . (LIST_LIMIT + 1));
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $truncated = count($rows) > LIST_LIMIT;
        $rows = array_slice($rows, 0, LIST_LIMIT);
        foreach ($rows as &$r) $r['ref'] = ref_code('RCV', $r['id']);
        unset($r);
        $total = 0;
        foreach ($rows as $r) if ($r['status'] === 'active') $total += (float)$r['quantity'];
        respond(true, ['rows' => $rows, 'range' => $range, 'truncated' => $truncated, 'total_qty' => $total]);
    }

    if ($view === 'transfers') {
        $params = [];
        $where = 'WHERE 1=1' . store_range_sql('t.created_at', $range, $params);
        if (!empty($_GET['product_id'])) { $where .= ' AND t.product_id = ?'; $params[] = (int)$_GET['product_id']; }
        if (!empty($_GET['user_id']))    { $where .= ' AND t.created_by = ?'; $params[] = (int)$_GET['user_id']; }
        if (!empty($_GET['location']) && valid_location($_GET['location'])) {
            $where .= ' AND (t.source = ? OR t.destination = ?)';
            $params[] = $_GET['location'];
            $params[] = $_GET['location'];
        }
        if (!empty($_GET['status']) && in_array($_GET['status'], ['pending', 'approved', 'completed', 'cancelled'], true)) {
            $where .= ' AND t.status = ?';
            $params[] = $_GET['status'];
        }

        $stmt = $pdo->prepare("SELECT t.*, " . ITEM_NAME_SQL . " AS product_name, COALESCE(pv.unit, p.unit) AS unit,
                CASE WHEN t.output_product_id IS NULL THEN NULL WHEN ov.id IS NOT NULL THEN CONCAT(op.name, ' — ', ov.variant_name) ELSE op.name END AS output_name,
                COALESCE(ov.unit, op.unit) AS output_unit,
                u.full_name AS staff, au.full_name AS approved_by_name, cu.full_name AS completed_by_name, xu.full_name AS cancelled_by_name
            FROM stock_transfers t
            JOIN products p ON p.id = t.product_id
            LEFT JOIN product_variants pv ON pv.id = t.variant_id
            LEFT JOIN products op ON op.id = t.output_product_id
            LEFT JOIN product_variants ov ON ov.id = t.output_variant_id
            LEFT JOIN users u ON u.id = t.created_by
            LEFT JOIN users au ON au.id = t.approved_by
            LEFT JOIN users cu ON cu.id = t.completed_by
            LEFT JOIN users xu ON xu.id = t.cancelled_by
            $where ORDER BY t.created_at DESC, t.id DESC LIMIT " . (LIST_LIMIT + 1));
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $truncated = count($rows) > LIST_LIMIT;
        $rows = array_slice($rows, 0, LIST_LIMIT);
        foreach ($rows as &$r) $r['ref'] = ref_code('TRF', $r['id']);
        unset($r);
        if (is_admin_user($user)) {
            $lines = transfer_cost_lines($pdo, array_column($rows, 'id'));
            foreach ($rows as &$r) $r['costs'] = $lines[$r['id']] ?? [];
            unset($r);
        } else {
            $rows = array_map(fn($r) => strip_cost_fields($r, ['processing_cost', 'unit_cost', 'input_cost', 'total_cost', 'output_unit_cost']), $rows);
        }
        respond(true, ['rows' => $rows, 'range' => $range, 'truncated' => $truncated]);
    }

    if ($view === 'adjustments') {
        $params = [];
        $where = 'WHERE 1=1' . store_range_sql('sa.created_at', $range, $params);
        if (!empty($_GET['product_id'])) { $where .= ' AND sa.product_id = ?'; $params[] = (int)$_GET['product_id']; }
        if (!empty($_GET['user_id']))    { $where .= ' AND sa.adjusted_by = ?'; $params[] = (int)$_GET['user_id']; }
        if (!empty($_GET['location']) && valid_location($_GET['location'])) { $where .= ' AND sa.location = ?'; $params[] = $_GET['location']; }

        $stmt = $pdo->prepare("SELECT sa.*, " . ITEM_NAME_SQL . " AS product_name, COALESCE(pv.unit, p.unit) AS unit, u.full_name AS staff
            FROM stock_adjustments sa
            JOIN products p ON p.id = sa.product_id
            LEFT JOIN product_variants pv ON pv.id = sa.variant_id
            LEFT JOIN users u ON u.id = sa.adjusted_by
            $where ORDER BY sa.created_at DESC, sa.id DESC LIMIT " . (LIST_LIMIT + 1));
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $truncated = count($rows) > LIST_LIMIT;
        $rows = array_slice($rows, 0, LIST_LIMIT);
        foreach ($rows as &$r) $r['ref'] = ref_code('ADJ', $r['id']);
        unset($r);
        respond(true, ['rows' => $rows, 'range' => $range, 'truncated' => $truncated]);
    }

    if ($view === 'movements' || $view === 'report') {
        $params = [];
        $where = movements_where($range, $_GET, $params);

        $stmt = $pdo->prepare("SELECT mv.ts, mv.mtype, mv.location, mv.product_id, mv.variant_id, mv.qty, mv.ref, mv.note,
                CASE WHEN mv.variant_id > 0 THEN CONCAT(p.name, ' — ', COALESCE(pv.variant_name, 'removed type')) ELSE p.name END AS product_name,
                COALESCE(CASE WHEN mv.ref LIKE 'PUR-%' THEN (SELECT fi.unit FROM farm_purchase_items fi WHERE fi.purchase_id = CAST(SUBSTRING(mv.ref, 5) AS UNSIGNED) AND fi.product_id = mv.product_id AND COALESCE(fi.variant_id, 0) = mv.variant_id LIMIT 1) END, pv.unit, p.unit) AS unit, COALESCE(u.full_name, '—') AS staff
            FROM (" . movements_union_sql() . ") mv
            JOIN products p ON p.id = mv.product_id
            LEFT JOIN product_variants pv ON pv.id = mv.variant_id
            LEFT JOIN users u ON u.id = mv.user_id
            $where ORDER BY mv.ts DESC, mv.ref DESC LIMIT " . (LIST_LIMIT + 1));
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $truncated = count($rows) > LIST_LIMIT;
        $rows = array_slice($rows, 0, LIST_LIMIT);

        if ($view === 'movements') {
            respond(true, ['rows' => $rows, 'range' => $range, 'truncated' => $truncated]);
        }

        // ---- report: totals per product/type ----
        $params2 = [];
        $where2 = movements_where($range, $_GET, $params2);
        $agg = $pdo->prepare("SELECT mv.product_id, mv.variant_id,
                SUM(CASE WHEN mv.location = 'store' AND mv.mtype IN ('farm_receipt','receipt_reversal') THEN mv.qty ELSE 0 END) AS received,
                SUM(CASE WHEN mv.location = 'pos' AND mv.mtype IN ('transfer_in','transfer_reversal') THEN mv.qty ELSE 0 END) AS to_pos,
                SUM(CASE WHEN mv.location = 'pos' AND mv.mtype = 'sale' THEN -mv.qty ELSE 0 END) AS sold,
                SUM(CASE WHEN mv.location = 'store' AND mv.mtype = 'damage' THEN -mv.qty ELSE 0 END) AS damaged_store,
                SUM(CASE WHEN mv.location = 'pos' AND mv.mtype = 'damage' THEN -mv.qty ELSE 0 END) AS damaged_pos
            FROM (" . movements_union_sql() . ") mv
            $where2 GROUP BY mv.product_id, mv.variant_id");
        $agg->execute($params2);
        $flows = [];
        foreach ($agg->fetchAll() as $f) $flows[$f['product_id'] . '-' . $f['variant_id']] = $f;

        $items = $pdo->query('SELECT * FROM (' . stock_items_sql(false) . ') x ORDER BY label ASC')->fetchAll();
        $summary = [];
        $totals = ['received' => 0, 'store_now' => 0, 'to_pos' => 0, 'pos_now' => 0, 'sold' => 0, 'damaged_store' => 0, 'damaged_pos' => 0];
        $filterProduct = !empty($_GET['product_id']) ? (int)$_GET['product_id'] : 0;
        foreach ($items as $it) {
            if ($filterProduct && (int)$it['product_id'] !== $filterProduct) continue;
            $f = $flows[$it['product_id'] . '-' . $it['variant_id']] ?? null;
            $row = [
                'product_id' => (int)$it['product_id'], 'variant_id' => (int)$it['variant_id'],
                'label' => $it['label'], 'unit' => $it['unit'],
                'received'      => to_qty($f['received'] ?? 0),
                'store_now'     => to_qty($it['store_qty']),
                'to_pos'        => to_qty($f['to_pos'] ?? 0),
                'pos_now'       => to_qty($it['pos_qty']),
                'sold'          => to_qty($f['sold'] ?? 0),
                'damaged_store' => to_qty($f['damaged_store'] ?? 0),
                'damaged_pos'   => to_qty($f['damaged_pos'] ?? 0),
            ];
            // leave out items that never moved and hold nothing
            if (!$row['received'] && !$row['store_now'] && !$row['to_pos'] && !$row['pos_now'] && !$row['sold'] && !$row['damaged_store'] && !$row['damaged_pos']) continue;
            foreach ($totals as $k => $_) $totals[$k] += $row[$k];
            $summary[] = $row;
        }
        foreach ($totals as $k => $v) $totals[$k] = round($v, 3);

        respond(true, ['summary' => $summary, 'totals' => $totals, 'rows' => $rows, 'range' => $range, 'truncated' => $truncated]);
    }

    respond(false, null, 'Unknown view.', 422);
}

/* =========================================================
   POST - record something new
   ========================================================= */
if ($method === 'POST') {
    require_role(['admin', 'worker']);
    $d = body();
    $action = clean($d['action'] ?? '');

    /* ---- Farm -> Main Store ---- */
    if ($action === 'receipt') {
        $missing = missing_fields($d, ['product_id', 'quantity']);
        if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
        $qty = to_qty($d['quantity']);
        if ($qty <= 0) respond(false, null, 'Enter a valid quantity.', 422);
        $item = resolve_stock_item($pdo, $d['product_id'], $d['variant_id'] ?? null);

        $farm = clean($d['farm_name'] ?? '');
        $refNo = clean($d['reference_no'] ?? '');
        $note = clean($d['note'] ?? '');

        try {
            $pdo->beginTransaction();
            $pdo->prepare('INSERT INTO farm_receipts (product_id, variant_id, quantity, farm_name, reference_no, note, status, received_by, received_at)
                           VALUES (?,?,?,?,?,?,?,?,NOW())')
                ->execute([$item['product']['id'], $item['variant_id'], $qty, $farm ?: null, $refNo ?: null, $note ?: null, 'active', $user['id']]);
            $id = (int)$pdo->lastInsertId();
            $balance = change_stock($pdo, 'store', (int)$item['product']['id'], $item['key'], $qty, $item['label']);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not record the farm receipt.', 500);
        }

        log_activity($pdo, $user, 'create', 'stock_receipt', $id,
            'Received ' . fmt_qty($qty) . ' ' . $item['unit'] . ' x "' . $item['label'] . '" from the farm into the Main Store' . ($farm ? ' (' . $farm . ')' : ''));
        respond(true, ['id' => $id, 'ref' => ref_code('RCV', $id), 'store_balance' => $balance], 'Received into the Main Store. Store stock is now ' . fmt_qty($balance) . ' ' . $item['unit'] . '.');
    }

    /* ---- Farm purchase: many products + shared expenses, in ONE transaction ---- */
    if ($action === 'purchase') {
        $rawItems = is_array($d['items'] ?? null) ? $d['items'] : [];
        $rawExpenses = is_array($d['expenses'] ?? null) ? $d['expenses'] : [];
        $method = ($d['allocation_method'] ?? 'value') === 'quantity' ? 'quantity' : 'value';

        $lines = [];
        foreach ($rawItems as $i => $ri) {
            if (empty($ri['product_id']) && empty($ri['quantity'])) continue; // an empty row
            $qty = to_qty($ri['quantity'] ?? 0);
            if ($qty <= 0) respond(false, null, 'Enter the quantity for every product (row ' . ($i + 1) . ').', 422);
            if (!isset($ri['unit_price']) || $ri['unit_price'] === '' || (float)$ri['unit_price'] < 0) respond(false, null, 'Enter the purchase price per unit for every product (row ' . ($i + 1) . ').', 422);
            $item = resolve_stock_item($pdo, $ri['product_id'] ?? 0, $ri['variant_id'] ?? null);
            $price = round((float)$ri['unit_price'], 2);
            // Farm purchases are recorded in KG or Bag only
            $unit = strtolower(clean($ri['unit'] ?? ''));
            if ($unit === '') $unit = in_array(strtolower($item['unit']), ['kg', 'bag'], true) ? strtolower($item['unit']) : 'kg';
            if (!in_array($unit, ['kg', 'bag'], true)) respond(false, null, 'Choose KG or Bag as the unit (row ' . ($i + 1) . ').', 422);
            $lines[] = ['item' => $item, 'quantity' => $qty, 'unit' => $unit, 'unit_price' => $price, 'purchase_total' => round($qty * $price, 2)];
        }
        if (!$lines) respond(false, null, 'Add at least one product.', 422);

        $expenses = [];
        $adminTotal = 0.0;
        $transportTotal = 0.0;
        foreach ($rawExpenses as $re) {
            $amt = round((float)($re['amount'] ?? 0), 2);
            if ($amt <= 0) continue;
            $cat = in_array($re['category'] ?? '', SHARED_EXPENSE_CATEGORIES, true) ? $re['category'] : 'other';
            $expenses[] = ['category' => $cat, 'description' => clean($re['description'] ?? ''), 'amount' => $amt];
            if ($cat === 'transport') $transportTotal += $amt; else $adminTotal += $amt;
        }
        $alloc = allocate_shared_costs($lines, $adminTotal, $transportTotal, $method);

        $purchaseTotal = 0.0;
        foreach ($lines as $l) $purchaseTotal += $l['purchase_total'];
        $landedTotal = round($purchaseTotal + $adminTotal + $transportTotal, 2);
        $farm = clean($d['farm_name'] ?? '');
        $refNo = clean($d['reference_no'] ?? '');
        $note = clean($d['note'] ?? '');

        try {
            $pdo->beginTransaction();
            $pdo->prepare('INSERT INTO farm_purchases (farm_name, reference_no, note, allocation_method, purchase_total, admin_total, transport_total, landed_total, status, received_by, received_at)
                           VALUES (?,?,?,?,?,?,?,?,?,?,NOW())')
                ->execute([$farm ?: null, $refNo ?: null, $note ?: null, $method, round($purchaseTotal, 2), round($adminTotal, 2), round($transportTotal, 2), $landedTotal, 'active', $user['id']]);
            $pid0 = (int)$pdo->lastInsertId();

            $insItem = $pdo->prepare('INSERT INTO farm_purchase_items (purchase_id, product_id, variant_id, quantity, unit, unit_price, purchase_total, alloc_admin, alloc_transport, landed_total, landed_unit_cost)
                                      VALUES (?,?,?,?,?,?,?,?,?,?,?)');
            foreach ($lines as $i => $l) {
                $landed = round($l['purchase_total'] + $alloc[$i]['alloc_admin'] + $alloc[$i]['alloc_transport'], 2);
                $unitCost = round($landed / $l['quantity'], 4);
                $insItem->execute([$pid0, $l['item']['product']['id'], $l['item']['variant_id'], $l['quantity'], $l['unit'], $l['unit_price'], $l['purchase_total'],
                    $alloc[$i]['alloc_admin'], $alloc[$i]['alloc_transport'], $landed, $unitCost]);
                // the stock goes into the Main Store carrying its true (landed) cost
                add_costed_stock($pdo, 'store', (int)$l['item']['product']['id'], $l['item']['key'], $l['quantity'], $unitCost, $l['item']['label']);
            }
            $insEx = $pdo->prepare('INSERT INTO farm_purchase_expenses (purchase_id, category, description, amount) VALUES (?,?,?,?)');
            foreach ($expenses as $e) $insEx->execute([$pid0, $e['category'], $e['description'] ?: null, $e['amount']]);
            $pdo->commit();
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not record the farm purchase.', 500);
        }

        log_activity($pdo, $user, 'create', 'stock_receipt', $pid0,
            'Recorded farm purchase ' . ref_code('PUR', $pid0) . ': ' . count($lines) . ' product(s), purchase TZS ' . number_format($purchaseTotal) . ', shared expenses TZS ' . number_format($adminTotal + $transportTotal) . ', landed cost TZS ' . number_format($landedTotal));
        respond(true, ['id' => $pid0, 'ref' => ref_code('PUR', $pid0), 'landed_total' => $landedTotal], 'Purchase saved. The stock is in the Main Store with its full cost.');
    }

    /* ---- Transfer Main Store <-> POS / Shop (optionally with processing, e.g. milling) ---- */
    if ($action === 'transfer') {
        $missing = missing_fields($d, ['product_id', 'quantity', 'source', 'destination']);
        if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
        if (!valid_location($d['source']) || !valid_location($d['destination'])) respond(false, null, 'Choose a valid source and destination.', 422);
        if ($d['source'] === $d['destination']) respond(false, null, 'The source and destination must be different.', 422);
        $qty = to_qty($d['quantity']);
        if ($qty <= 0) respond(false, null, 'Enter a valid quantity.', 422);
        $item = resolve_stock_item($pdo, $d['product_id'], $d['variant_id'] ?? null);
        $note = clean($d['note'] ?? '');
        $status = (($d['status'] ?? 'completed') === 'pending') ? 'pending' : 'completed';
        $pid = (int)$item['product']['id'];

        // Processing / preparation on the way to the shop (any staff member can record it; the cost reports stay admin only)
        $outItem = null; $outQty = null; $procLines = []; $procTotal = 0.0;
        if (!empty($d['process'])) {
            if ($d['source'] !== 'store' || $d['destination'] !== 'pos') respond(false, null, 'Processing is recorded when moving stock from the Main Store to the POS / Shop.', 422);
            $outItem = resolve_stock_item($pdo, $d['output_product_id'] ?? 0, $d['output_variant_id'] ?? null);
            $outQty = to_qty($d['output_quantity'] ?? 0);
            if ($outQty <= 0) respond(false, null, 'Enter the quantity after processing (the finished quantity).', 422);
            $costRows = is_array($d['costs'] ?? null) ? $d['costs'] : [];
            foreach ($costRows as $c) {
                $amt = round((float)($c['amount'] ?? 0), 2);
                if ($amt < 0) respond(false, null, 'Processing costs cannot be negative.', 422);
                if ($amt == 0) continue;
                $procLines[] = ['activity' => clean($c['activity'] ?? '') ?: 'Processing', 'amount' => $amt];
                $procTotal += $amt;
            }
        }

        try {
            $pdo->beginTransaction();
            // Never move more than the source holds (checked again, with the row locked, when stock moves)
            $available = stock_at($pdo, $d['source'], $pid, $item['key'], true);
            if ($qty > $available) {
                throw new StockShortage('Not enough stock of "' . $item['label'] . '" in the ' . location_label($d['source'])
                    . '. Available: ' . fmt_qty($available) . ' ' . $item['unit'] . ', requested: ' . fmt_qty($qty) . '.');
            }

            $pdo->prepare('INSERT INTO stock_transfers (product_id, variant_id, quantity, source, destination, status, note, created_by, created_at,
                               output_product_id, output_variant_id, output_quantity, processing_cost)
                           VALUES (?,?,?,?,?,?,?,?,NOW(),?,?,?,?)')
                ->execute([$pid, $item['variant_id'], $qty, $d['source'], $d['destination'], $status, $note ?: null, $user['id'],
                    $outItem ? $outItem['product']['id'] : null, $outItem ? $outItem['variant_id'] : null, $outQty, round($procTotal, 2)]);
            $id = (int)$pdo->lastInsertId();
            $insC = $pdo->prepare('INSERT INTO stock_transfer_costs (transfer_id, activity, amount) VALUES (?,?,?)');
            foreach ($procLines as $c) $insC->execute([$id, $c['activity'], $c['amount']]);

            if ($status === 'completed') {
                $row = $pdo->prepare('SELECT * FROM stock_transfers WHERE id = ?');
                $row->execute([$id]);
                complete_transfer_stock($pdo, $row->fetch());
                $pdo->prepare('UPDATE stock_transfers SET completed_by = ?, completed_at = NOW() WHERE id = ?')->execute([$user['id'], $id]);
            }
            $pdo->commit();
        } catch (StockShortage $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, $e->getMessage(), 422);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not record the transfer.', 500);
        }

        log_activity($pdo, $user, 'create', 'stock_transfer', $id,
            ($status === 'completed' ? 'Transferred ' : 'Created a pending transfer of ') . fmt_qty($qty) . ' ' . $item['unit'] . ' x "' . $item['label'] . '" from '
            . location_label($d['source']) . ' to ' . location_label($d['destination'])
            . ($outItem ? ' (processed into ' . fmt_qty($outQty) . ' ' . $outItem['unit'] . ' x "' . $outItem['label'] . '", processing cost TZS ' . number_format($procTotal) . ')' : ''));
        respond(true, ['id' => $id, 'ref' => ref_code('TRF', $id), 'status' => $status],
            $status === 'completed' ? 'Transfer completed. Stock and its cost have been updated in both locations.' : 'Transfer saved as Pending. Stock moves once it is completed.');
    }

    /* ---- Manual adjustment at one location (admin only) ---- */
    if ($action === 'adjustment') {
        require_role(['admin']);
        $missing = missing_fields($d, ['product_id', 'quantity', 'location', 'direction', 'reason']);
        if ($missing) respond(false, null, 'Missing fields: ' . implode(', ', $missing), 422);
        if (!valid_location($d['location'])) respond(false, null, 'Choose the location to adjust.', 422);
        if (!in_array($d['direction'], ['increase', 'decrease'], true)) respond(false, null, 'Choose whether to increase or decrease the stock.', 422);
        $qty = to_qty($d['quantity']);
        if ($qty <= 0) respond(false, null, 'Enter a valid quantity.', 422);
        $item = resolve_stock_item($pdo, $d['product_id'], $d['variant_id'] ?? null);
        $signed = $d['direction'] === 'increase' ? $qty : -$qty;
        $reason = clean($d['reason']);
        $note = clean($d['note'] ?? '');

        try {
            $pdo->beginTransaction();
            $balance = change_stock($pdo, $d['location'], (int)$item['product']['id'], $item['key'], $signed, $item['label']);
            $pdo->prepare('INSERT INTO stock_adjustments (product_id, variant_id, location, quantity_change, reason, note, adjusted_by, created_at)
                           VALUES (?,?,?,?,?,?,?,NOW())')
                ->execute([$item['product']['id'], $item['variant_id'], $d['location'], $signed, $reason, $note ?: null, $user['id']]);
            $id = (int)$pdo->lastInsertId();
            $pdo->commit();
        } catch (StockShortage $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, $e->getMessage(), 422);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not record the adjustment.', 500);
        }

        log_activity($pdo, $user, 'update', 'stock_adjustment', $id,
            'Adjusted ' . location_label($d['location']) . ' stock of "' . $item['label'] . '" by ' . ($signed > 0 ? '+' : '-') . fmt_qty($qty) . ' ' . $item['unit'] . ' (' . $reason . ')');
        respond(true, ['id' => $id, 'ref' => ref_code('ADJ', $id), 'balance' => $balance], 'Stock adjusted. ' . location_label($d['location']) . ' now holds ' . fmt_qty($balance) . ' ' . $item['unit'] . '.');
    }

    respond(false, null, 'Unknown action.', 422);
}

/* =========================================================
   PUT - approve / complete / cancel (admin only)
   ========================================================= */
if ($method === 'PUT') {
    require_role(['admin']);
    $d = body();
    $action = clean($d['action'] ?? '');
    $id = (int)($d['id'] ?? 0);
    if (!$id) respond(false, null, 'Record id is required.', 422);

    /* ---- cancel a farm receipt: takes the quantity back out of the Main Store ---- */
    if ($action === 'cancel_receipt') {
        $stmt = $pdo->prepare('SELECT * FROM farm_receipts WHERE id = ?');
        $stmt->execute([$id]);
        $rec = $stmt->fetch();
        if (!$rec) respond(false, null, 'Receipt not found.', 404);
        if ($rec['status'] === 'cancelled') respond(false, null, 'This receipt is already cancelled.', 409);
        $item = item_from_record($pdo, $rec);
        try {
            $pdo->beginTransaction();
            change_stock($pdo, 'store', (int)$rec['product_id'], $item['key'], -to_qty($rec['quantity']), $item['label']);
            $pdo->prepare("UPDATE farm_receipts SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?")->execute([$user['id'], $id]);
            $pdo->commit();
        } catch (StockShortage $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'This receipt cannot be cancelled because part of it has already left the Main Store. ' . $e->getMessage(), 422);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not cancel the receipt.', 500);
        }
        log_activity($pdo, $user, 'delete', 'stock_receipt', $id, 'Cancelled farm receipt ' . ref_code('RCV', $id) . ' (' . fmt_qty($rec['quantity']) . ' ' . $item['unit'] . ' x "' . $item['label'] . '" removed from the Main Store)');
        respond(true, null, 'Receipt cancelled and the stock removed from the Main Store.');
    }

    /* ---- cancel a farm purchase: takes every product of it back out of the Main Store ---- */
    if ($action === 'cancel_purchase') {
        $stmt = $pdo->prepare('SELECT * FROM farm_purchases WHERE id = ?');
        $stmt->execute([$id]);
        $fp = $stmt->fetch();
        if (!$fp) respond(false, null, 'Purchase not found.', 404);
        if ($fp['status'] === 'cancelled') respond(false, null, 'This purchase is already cancelled.', 409);
        $its = $pdo->prepare('SELECT * FROM farm_purchase_items WHERE purchase_id = ?');
        $its->execute([$id]);
        try {
            $pdo->beginTransaction();
            foreach ($its->fetchAll() as $row) {
                $it = item_from_record($pdo, $row);
                change_stock($pdo, 'store', (int)$row['product_id'], $it['key'], -to_qty($row['quantity']), $it['label']);
            }
            $pdo->prepare("UPDATE farm_purchases SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?")->execute([$user['id'], $id]);
            $pdo->commit();
        } catch (StockShortage $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'This purchase cannot be cancelled because part of it has already left the Main Store. ' . $e->getMessage(), 422);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not cancel the purchase.', 500);
        }
        log_activity($pdo, $user, 'delete', 'stock_receipt', $id, 'Cancelled farm purchase ' . ref_code('PUR', $id));
        respond(true, null, 'Purchase cancelled and its stock removed from the Main Store.');
    }

    /* ---- transfers ---- */
    $stmt = $pdo->prepare('SELECT * FROM stock_transfers WHERE id = ?');
    $stmt->execute([$id]);
    $t = $stmt->fetch();
    if (!$t) respond(false, null, 'Transfer not found.', 404);
    $item = item_from_record($pdo, $t);
    $pid = (int)$t['product_id'];
    $qty = to_qty($t['quantity']);
    $ref = ref_code('TRF', $id);

    if ($action === 'approve') {
        if ($t['status'] !== 'pending') respond(false, null, 'Only a Pending transfer can be approved.', 409);
        $pdo->prepare("UPDATE stock_transfers SET status = 'approved', approved_by = ?, approved_at = NOW() WHERE id = ?")->execute([$user['id'], $id]);
        log_activity($pdo, $user, 'update', 'stock_transfer', $id, 'Approved transfer ' . $ref);
        respond(true, null, 'Transfer approved. Complete it to move the stock.');
    }

    if ($action === 'complete') {
        if (!in_array($t['status'], ['pending', 'approved'], true)) respond(false, null, 'Only a Pending or Approved transfer can be completed.', 409);
        try {
            $pdo->beginTransaction();
            complete_transfer_stock($pdo, $t);
            $pdo->prepare("UPDATE stock_transfers SET status = 'completed', completed_by = ?, completed_at = NOW(),
                           approved_by = COALESCE(approved_by, ?), approved_at = COALESCE(approved_at, NOW()) WHERE id = ?")
                ->execute([$user['id'], $user['id'], $id]);
            $pdo->commit();
        } catch (StockShortage $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, $e->getMessage(), 422);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not complete the transfer.', 500);
        }
        log_activity($pdo, $user, 'update', 'stock_transfer', $id, 'Completed transfer ' . $ref . ': ' . fmt_qty($qty) . ' ' . $item['unit'] . ' x "' . $item['label'] . '" from ' . location_label($t['source']) . ' to ' . location_label($t['destination']));
        respond(true, null, 'Transfer completed. Stock has been updated in both locations.');
    }

    if ($action === 'cancel') {
        if ($t['status'] === 'cancelled') respond(false, null, 'This transfer is already cancelled.', 409);
        $wasCompleted = $t['status'] === 'completed';
        try {
            $pdo->beginTransaction();
            if ($wasCompleted) {
                // put the stock back: take it from the destination, return it to the source
                reverse_transfer_stock($pdo, $t);
            }
            $pdo->prepare("UPDATE stock_transfers SET status = 'cancelled', cancelled_by = ?, cancelled_at = NOW() WHERE id = ?")->execute([$user['id'], $id]);
            $pdo->commit();
        } catch (StockShortage $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'This transfer cannot be cancelled because the stock has already left the ' . location_label($t['destination']) . '. ' . $e->getMessage(), 422);
        } catch (Throwable $e) {
            if ($pdo->inTransaction()) $pdo->rollBack();
            respond(false, null, 'Could not cancel the transfer.', 500);
        }
        log_activity($pdo, $user, 'update', 'stock_transfer', $id, 'Cancelled transfer ' . $ref . ($wasCompleted ? ' (stock returned to ' . location_label($t['source']) . ')' : ''));
        respond(true, null, $wasCompleted ? 'Transfer cancelled and the stock returned to ' . location_label($t['source']) . '.' : 'Transfer cancelled.');
    }

    respond(false, null, 'Unknown action.', 422);
}

respond(false, null, 'Unsupported method.', 405);
