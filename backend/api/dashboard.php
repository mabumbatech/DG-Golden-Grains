<?php
require_once __DIR__ . '/../db.php';
require_once __DIR__ . '/../helpers/functions.php';
require_once __DIR__ . '/../helpers/report_helper.php';
require_once __DIR__ . '/../helpers/access_helper.php';

$user = require_login();
$pdo = get_db();

$today = today();

// A credit (madeni) is "due soon" when its payment deadline is within this
// many days from today (but not today itself - that is "due today").
const DEBT_DUE_SOON_DAYS = 3;

// Which alerts each person has already seen in the notification bell.
// Created on first use, so no manual database import is needed.
function ensure_notification_table(PDO $pdo): void {
    $pdo->exec('CREATE TABLE IF NOT EXISTS `notification_seen` (
        `user_id` INT UNSIGNED NOT NULL,
        `alert_key` VARCHAR(80) NOT NULL,
        `seen_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (`user_id`, `alert_key`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4');
}

// POST: the person opened the bell - remember these alerts as seen for THIS user.
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $d = body();
    $keys = (isset($d['seen_keys']) && is_array($d['seen_keys'])) ? array_slice($d['seen_keys'], 0, 200) : [];
    $saved = 0;
    try {
        ensure_notification_table($pdo);
        $ins = $pdo->prepare('INSERT IGNORE INTO notification_seen (user_id, alert_key) VALUES (?, ?)');
        foreach ($keys as $k) {
            $k = (string)$k;
            if (!preg_match('/^(overdue|due|soon|low):[A-Za-z0-9:_-]{1,60}$/', $k)) continue;
            $ins->execute([$user['id'], $k]);
            $saved++;
        }
    } catch (Exception $e) {
        respond(false, null, 'Could not save notification status.', 500);
    }
    respond(true, ['saved' => $saved]);
}

// Profit for any period: GET dashboard.php?profit=1&mode=all
// or ?profit=1&mode=custom&from=YYYY-MM-DD&to=YYYY-MM-DD. Admins only.
// Same formula as the reports: net = gross profit - expenses - damage loss.
if (!empty($_GET['profit'])) {
    if (!is_admin_user($user)) {
        respond(false, null, 'You do not have permission to view profit.', 403);
    }
    $valid_date = function ($d) {
        $dt = DateTime::createFromFormat('Y-m-d', (string)$d);
        return $dt && $dt->format('Y-m-d') === $d;
    };
    $mode = (($_GET['mode'] ?? 'all') === 'custom') ? 'custom' : 'all';
    if ($mode === 'custom') {
        $from = (string)($_GET['from'] ?? '');
        $to = (string)($_GET['to'] ?? '');
        if (!$valid_date($from) || !$valid_date($to)) {
            respond(false, null, 'Please choose a valid start and end date.', 422);
        }
        if ($from > $to) {
            respond(false, null, 'The start date cannot be after the end date.', 422);
        }
    } else {
        // All time: from the earliest record the shop has, up to today.
        $stmt = $pdo->query('SELECT MIN(d) FROM (
            SELECT MIN(sale_date) AS d FROM sale_transactions
            UNION ALL SELECT MIN(expense_date) FROM expenses
            UNION ALL SELECT MIN(damage_date) FROM damages) t');
        $first = $stmt->fetchColumn();
        $from = $first ?: $today;
        $to = $today;
    }

    $stmt = $pdo->prepare('SELECT COALESCE(SUM(total_amount),0) AS total_sales,
            COALESCE(SUM(total_profit),0) AS gross_profit, COUNT(*) AS transactions
        FROM sale_transactions WHERE sale_date BETWEEN ? AND ?');
    $stmt->execute([$from, $to]);
    $sales = $stmt->fetch();

    $stmt = $pdo->prepare('SELECT COALESCE(SUM(amount),0) FROM expenses WHERE expense_date BETWEEN ? AND ?');
    $stmt->execute([$from, $to]);
    $expenses = (float)$stmt->fetchColumn();

    $stmt = $pdo->prepare('SELECT COALESCE(SUM(loss_value),0) FROM damages WHERE damage_date BETWEEN ? AND ?');
    $stmt->execute([$from, $to]);
    $damages = (float)$stmt->fetchColumn();

    $gross = (float)$sales['gross_profit'];
    respond(true, [
        'mode' => $mode,
        'from' => $from,
        'to' => $to,
        'total_sales' => (float)$sales['total_sales'],
        'transactions' => (int)$sales['transactions'],
        'gross_profit' => round($gross, 2),
        'total_expenses' => round($expenses, 2),
        'total_damage_loss' => round($damages, 2),
        'net_profit' => round($gross - $expenses - $damages, 2),
    ]);
}

// Low stock alerts. A plain product (no types) is checked against its own
// stock/reorder level. A product that HAS types is skipped at that level and
// each of its types is checked individually, shown as "Parent → Type"
// (e.g. "Rice → Kyela 25kg").
try {
    $stmt = $pdo->query("
        (SELECT p.id, NULL AS variant_id, p.name, p.stock_quantity, p.reorder_level, p.unit
         FROM products p
         WHERE p.status = 'active' AND p.stock_quantity <= p.reorder_level
           AND NOT EXISTS (SELECT 1 FROM product_variants pv WHERE pv.product_id = p.id))
        UNION ALL
        (SELECT p.id, pv.id AS variant_id, CONCAT(p.name, ' → ', pv.variant_name) AS name, pv.stock_quantity, pv.reorder_level, pv.unit
         FROM product_variants pv
         JOIN products p ON p.id = pv.product_id
         WHERE pv.status = 'active' AND p.status = 'active' AND pv.stock_quantity <= pv.reorder_level)
        ORDER BY stock_quantity ASC LIMIT 15
    ");
    $lowStock = $stmt->fetchAll();
} catch (Exception $e) {
    $stmt = $pdo->query('SELECT id, name, stock_quantity, reorder_level, unit FROM products
        WHERE status = "active" AND stock_quantity <= reorder_level
        ORDER BY stock_quantity ASC LIMIT 15');
    $lowStock = $stmt->fetchAll();
}
foreach ($lowStock as &$lsRow) {
    $lsRow['key'] = 'low:' . $lsRow['id'] . ':' . (int)($lsRow['variant_id'] ?? 0);
}
unset($lsRow);

// Debt (madeni) due-date alerts - debts due today, and debts already
// overdue with nothing paid off yet. Wrapped defensively in case the
// credit-system upgrade script hasn't been run yet.
$dueTodayDebts = [];
$overdueDebts = [];
$dueSoonDebts = [];
$soonLimit = date('Y-m-d', strtotime($today . ' +' . DEBT_DUE_SOON_DAYS . ' days'));
try {
    $stmt = $pdo->query("SELECT s.id, s.customer_name, s.credit_deadline, s.total_amount,
            COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = s.id), 0) AS paid_amount
        FROM sale_transactions s WHERE s.payment_method = 'credit'");
    $allCredits = $stmt->fetchAll();

    foreach ($allCredits as $c) {
        $remaining = round((float)$c['total_amount'] - (float)$c['paid_amount'], 2);
        if ($remaining <= 0 || empty($c['credit_deadline'])) continue;
        if ($c['credit_deadline'] === $today) {
            $dueTodayDebts[] = ['id' => (int)$c['id'], 'key' => 'due:' . (int)$c['id'], 'customer_name' => $c['customer_name'], 'remaining' => $remaining];
        } elseif ($c['credit_deadline'] < $today) {
            $overdueDebts[] = ['id' => (int)$c['id'], 'key' => 'overdue:' . (int)$c['id'], 'customer_name' => $c['customer_name'], 'remaining' => $remaining, 'deadline' => $c['credit_deadline']];
        } elseif ($c['credit_deadline'] <= $soonLimit) {
            $daysLeft = (int)round((strtotime($c['credit_deadline']) - strtotime($today)) / 86400);
            $dueSoonDebts[] = ['id' => (int)$c['id'], 'key' => 'soon:' . (int)$c['id'], 'customer_name' => $c['customer_name'], 'remaining' => $remaining, 'deadline' => $c['credit_deadline'], 'days_left' => $daysLeft];
        }
    }
} catch (Exception $e) {
    // Credit-system columns don't exist yet - no alerts, no crash.
}

usort($dueSoonDebts, function ($a, $b) { return strcmp($a['deadline'], $b['deadline']); });

$debtAlerts = [
    'due_today' => $dueTodayDebts,
    'due_soon' => $dueSoonDebts,
    'due_soon_days' => DEBT_DUE_SOON_DAYS,
    'overdue' => $overdueDebts,
    'due_today_total' => array_sum(array_column($dueTodayDebts, 'remaining')),
    'due_soon_total' => array_sum(array_column($dueSoonDebts, 'remaining')),
    'overdue_total' => array_sum(array_column($overdueDebts, 'remaining')),
];

// Alerts this person has already seen. Seen records for alerts that no longer
// exist (debt paid, stock refilled) are dropped, so if the same problem comes
// back later it counts as a NEW notification again.
$seenKeys = [];
try {
    ensure_notification_table($pdo);
    $activeKeys = array_merge(
        array_column($lowStock, 'key'),
        array_column($overdueDebts, 'key'),
        array_column($dueTodayDebts, 'key'),
        array_column($dueSoonDebts, 'key')
    );
    if ($activeKeys) {
        $marks = implode(',', array_fill(0, count($activeKeys), '?'));
        $pdo->prepare("DELETE FROM notification_seen WHERE user_id = ? AND alert_key NOT IN ($marks)")
            ->execute(array_merge([$user['id']], $activeKeys));
    } else {
        $pdo->prepare('DELETE FROM notification_seen WHERE user_id = ?')->execute([$user['id']]);
    }
    $sStmt = $pdo->prepare('SELECT alert_key FROM notification_seen WHERE user_id = ?');
    $sStmt->execute([$user['id']]);
    $seenKeys = $sStmt->fetchAll(PDO::FETCH_COLUMN);
} catch (Exception $e) {
    // Could not read/write seen status - show everything as new rather than fail.
}

// Lightweight mode used by the notification bell on every page: only the
// warnings, none of the heavy report numbers.
if (!empty($_GET['alerts'])) {
    respond(true, [
        'low_stock_alerts' => $lowStock,
        'debt_alerts' => $debtAlerts,
        'seen' => $seenKeys,
    ]);
}

// Today's and yesterday's reports
$todayReport = build_report($pdo, $today, $today);
$yesterday = date('Y-m-d', strtotime($today . ' -1 day'));
$yesterdayReport = build_report($pdo, $yesterday, $yesterday);

// Overall stock counts
$stmt = $pdo->query('SELECT
    COUNT(*) AS total_products,
    COUNT(*) AS total_items
    FROM products WHERE status = "active"');
$stock = $stmt->fetch();

// This month totals
[$mStart, $mEnd] = resolve_period('month', $today);
$monthReport = build_report($pdo, $mStart, $mEnd);

// Sales so far in the same stretch of LAST month (1st .. same day number),
// so "this month vs last month" compares like with like.
$prevMonthSales = 0.0;
try {
    $firstThis = new DateTime($today);
    $firstThis->modify('first day of this month');
    $prevStart = (clone $firstThis)->modify('-1 month');
    $prevDays = (int)$prevStart->format('t');
    $dayNo = min((int)date('j', strtotime($today)), $prevDays);
    $prevEnd = (clone $prevStart)->setDate((int)$prevStart->format('Y'), (int)$prevStart->format('n'), $dayNo);
    $stmt = $pdo->prepare('SELECT COALESCE(SUM(total_amount),0) FROM sale_transactions WHERE sale_date BETWEEN ? AND ?');
    $stmt->execute([$prevStart->format('Y-m-d'), $prevEnd->format('Y-m-d')]);
    $prevMonthSales = (float)$stmt->fetchColumn();
} catch (Exception $e) {
    // leave at zero
}

// Today's credit (madeni) sales - shown as a marker only, never subtracted
// from profit. Wrapped defensively in case the credit-system upgrade
// script hasn't been run yet on this install (older "sales" table without
// the payment_method column) - the dashboard should still load either way.
$creditToday = ['total_credit' => 0, 'credit_count' => 0];
try {
    // Only the part still on credit: whatever the customer paid at the time of the sale is not credit.
    $stmt = $pdo->prepare("SELECT COALESCE(SUM(GREATEST(total_amount - COALESCE((SELECT SUM(dp.amount) FROM debt_payments dp WHERE dp.sale_id = sale_transactions.id AND dp.payment_date = sale_transactions.sale_date), 0), 0)), 0) AS total_credit, COUNT(*) AS credit_count
                            FROM sale_transactions WHERE payment_method = 'credit' AND sale_date = ?");
    $stmt->execute([$today]);
    $creditToday = $stmt->fetch();
} catch (Exception $e) {
    // Column doesn't exist yet - fall back to zero, no crash.
}

// Daily sales for the last 30 days (zero-filled) - feeds the line chart.
$salesTrend = [];
try {
    $trendStart = date('Y-m-d', strtotime($today . ' -29 days'));
    $stmt = $pdo->prepare('SELECT sale_date, COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS n
                           FROM sale_transactions WHERE sale_date BETWEEN ? AND ? GROUP BY sale_date');
    $stmt->execute([$trendStart, $today]);
    $byDay = [];
    foreach ($stmt->fetchAll() as $r) $byDay[$r['sale_date']] = $r;
    for ($i = 0; $i < 30; $i++) {
        $d = date('Y-m-d', strtotime($trendStart . ' +' . $i . ' days'));
        $salesTrend[] = [
            'date' => $d,
            'total' => isset($byDay[$d]) ? (float)$byDay[$d]['total'] : 0.0,
            'count' => isset($byDay[$d]) ? (int)$byDay[$d]['n'] : 0,
        ];
    }
} catch (Exception $e) {
    $salesTrend = [];
}

// Sales by product category (today and this month) - feeds the donut chart.
function dashboard_category_sales(PDO $pdo, string $from, string $to): array
{
    try {
        $stmt = $pdo->prepare("
            SELECT COALESCE(c.name, 'Uncategorised') AS category, COALESCE(SUM(si.subtotal),0) AS total
            FROM sale_items si
            JOIN sale_transactions st ON st.id = si.transaction_id
            JOIN products p ON p.id = si.product_id
            LEFT JOIN categories c ON c.id = p.category_id
            WHERE st.sale_date BETWEEN ? AND ?
            GROUP BY COALESCE(c.name, 'Uncategorised')
            ORDER BY total DESC");
        $stmt->execute([$from, $to]);
        return array_map(function ($r) {
            return ['category' => $r['category'], 'total' => (float)$r['total']];
        }, $stmt->fetchAll());
    } catch (Exception $e) {
        return [];
    }
}
$categorySales = [
    'today' => dashboard_category_sales($pdo, $today, $today),
    'month' => dashboard_category_sales($pdo, $mStart, $mEnd),
];

$payload = [
    'shop_today' => $today,
    'today' => [
        'total_sales' => (float)$todayReport['sales']['total_sales'],
        'transactions' => (int)$todayReport['sales']['transactions'],
        'total_expenses' => (float)$todayReport['expenses']['total_expenses'],
        'total_damage_loss' => (float)$todayReport['damages']['total_loss'],
        'gross_profit' => (float)$todayReport['sales']['total_profit'],
        'net_profit' => (float)$todayReport['net_profit'],
        'total_credit' => (float)$creditToday['total_credit'],
        'credit_count' => (int)$creditToday['credit_count'],
    ],
    'yesterday' => [
        'total_sales' => (float)$yesterdayReport['sales']['total_sales'],
        'transactions' => (int)$yesterdayReport['sales']['transactions'],
        'total_expenses' => (float)$yesterdayReport['expenses']['total_expenses'],
        'total_damage_loss' => (float)$yesterdayReport['damages']['total_loss'],
        'net_profit' => (float)$yesterdayReport['net_profit'],
    ],
    'month' => [
        'total_sales' => (float)$monthReport['sales']['total_sales'],
        'prev_total_sales' => $prevMonthSales,
        'total_expenses' => (float)$monthReport['expenses']['total_expenses'],
        'net_profit' => (float)$monthReport['net_profit'],
    ],
    'stock' => [
        'total_products' => (int)($stock['total_products'] ?? 0),
        'total_items' => (int)($stock['total_items'] ?? 0),
    ],
    'low_stock_alerts' => $lowStock,
    'top_selling_today' => array_slice($todayReport['top_selling'], 0, 5),
    'debt_alerts' => $debtAlerts,
    'seen' => $seenKeys,
    'sales_trend' => $salesTrend,
    'category_sales' => $categorySales,
];

// Profit is for admins only - workers never receive it.
if (!is_admin_user($user)) {
    unset(
        $payload['today']['gross_profit'], $payload['today']['net_profit'], $payload['month']['net_profit'],
        $payload['today']['total_damage_loss'], // damage loss = quantity x purchasing price
        $payload['yesterday']['net_profit'], $payload['yesterday']['total_damage_loss']
    );
    $payload['top_selling_today'] = array_map(function ($row) {
        $row = hide_fields($row, ['profit']);
        if (!empty($row['types'])) $row['types'] = hide_fields_in_rows($row['types'], ['profit']);
        return $row;
    }, $payload['top_selling_today']);
}

respond(true, $payload);
