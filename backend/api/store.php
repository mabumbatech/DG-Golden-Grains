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
        $totals = ['store_qty' => 0, 'pos_qty' => 0];
        foreach ($rows as $r) {
            $totals['store_qty'] += (float)$r['store_qty'];
            $totals['pos_qty'] += (float)$r['pos_qty'];
        }
        respond(true, ['rows' => $rows, 'totals' => $totals]);
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
                u.full_name AS staff, au.full_name AS approved_by_name, cu.full_name AS completed_by_name, xu.full_name AS cancelled_by_name
            FROM stock_transfers t
            JOIN products p ON p.id = t.product_id
            LEFT JOIN product_variants pv ON pv.id = t.variant_id
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
                COALESCE(pv.unit, p.unit) AS unit, COALESCE(u.full_name, '—') AS staff
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

    /* ---- Transfer Main Store <-> POS / Shop ---- */
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

        try {
            $pdo->beginTransaction();
            // Never move more than the source holds (checked again, with the row locked, when stock moves)
            $available = stock_at($pdo, $d['source'], $pid, $item['key'], true);
            if ($qty > $available) {
                throw new StockShortage('Not enough stock of "' . $item['label'] . '" in the ' . location_label($d['source'])
                    . '. Available: ' . fmt_qty($available) . ' ' . $item['unit'] . ', requested: ' . fmt_qty($qty) . '.');
            }

            $pdo->prepare('INSERT INTO stock_transfers (product_id, variant_id, quantity, source, destination, status, note, created_by, created_at)
                           VALUES (?,?,?,?,?,?,?,?,NOW())')
                ->execute([$pid, $item['variant_id'], $qty, $d['source'], $d['destination'], $status, $note ?: null, $user['id']]);
            $id = (int)$pdo->lastInsertId();

            if ($status === 'completed') {
                change_stock($pdo, $d['source'], $pid, $item['key'], -$qty, $item['label']);
                change_stock($pdo, $d['destination'], $pid, $item['key'], $qty, $item['label']);
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
            . location_label($d['source']) . ' to ' . location_label($d['destination']));
        respond(true, ['id' => $id, 'ref' => ref_code('TRF', $id), 'status' => $status],
            $status === 'completed' ? 'Transfer completed. Stock has been updated in both locations.' : 'Transfer saved as Pending. Stock moves once it is completed.');
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
            change_stock($pdo, $t['source'], $pid, $item['key'], -$qty, $item['label']);
            change_stock($pdo, $t['destination'], $pid, $item['key'], $qty, $item['label']);
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
                change_stock($pdo, $t['destination'], $pid, $item['key'], -$qty, $item['label']);
                change_stock($pdo, $t['source'], $pid, $item['key'], $qty, $item['label']);
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
