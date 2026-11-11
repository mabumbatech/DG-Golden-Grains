<?php
/**
 * GOLDEN GRAINS - Store Management helper
 *
 * Journey of a product:  Farm -> Main Store (warehouse) -> POS / Shop -> Customer.
 *
 *  - POS/shop stock is the stock the system already had: product_variants.stock_quantity
 *    (or products.stock_quantity for a product without types). Sales use it.
 *  - Main store stock is kept separately in store_stock (variant_id 0 = the product itself).
 *  - Every movement is traceable: farm receipts, transfers and adjustments have their own
 *    tables, and movements_union_sql() joins them with sales, purchases and damages into one
 *    inventory movement history, so nothing is stored twice and nothing can drift apart.
 */

class StockShortage extends Exception {}

const STORE_LOCATIONS = ['store' => 'Main Store', 'pos' => 'POS / Shop'];

function location_label(string $loc): string
{
    return STORE_LOCATIONS[$loc] ?? $loc;
}

/**
 * Creates the Store Management tables and the two new damage columns when they are missing,
 * so an existing installation upgrades itself the first time these pages are used.
 */
function ensure_store_schema(PDO $pdo): void
{
    static $done = false;
    if ($done) return;

    $has = fn(string $table) => (bool)$pdo->query("SHOW TABLES LIKE '$table'")->fetchColumn();

    if (!$has('store_stock')) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS `store_stock` (
          `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          `product_id` INT UNSIGNED NOT NULL,
          `variant_id` INT UNSIGNED NOT NULL DEFAULT 0,
          `quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
          `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          UNIQUE KEY `uniq_store_item` (`product_id`, `variant_id`),
          CONSTRAINT `fk_store_stock_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
    if (!$has('farm_receipts')) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS `farm_receipts` (
          `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          `product_id` INT UNSIGNED NOT NULL,
          `variant_id` INT UNSIGNED NULL DEFAULT NULL,
          `quantity` DECIMAL(12,3) NOT NULL,
          `farm_name` VARCHAR(150) NULL DEFAULT NULL,
          `reference_no` VARCHAR(60) NULL DEFAULT NULL,
          `note` VARCHAR(255) NULL DEFAULT NULL,
          `status` ENUM('active','cancelled') NOT NULL DEFAULT 'active',
          `received_by` INT UNSIGNED NOT NULL,
          `received_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `cancelled_by` INT UNSIGNED NULL DEFAULT NULL,
          `cancelled_at` DATETIME NULL DEFAULT NULL,
          PRIMARY KEY (`id`),
          KEY `idx_fr_product` (`product_id`),
          KEY `idx_fr_received` (`received_at`),
          CONSTRAINT `fk_fr_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
    if (!$has('stock_transfers')) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS `stock_transfers` (
          `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          `product_id` INT UNSIGNED NOT NULL,
          `variant_id` INT UNSIGNED NULL DEFAULT NULL,
          `quantity` DECIMAL(12,3) NOT NULL,
          `source` ENUM('store','pos') NOT NULL,
          `destination` ENUM('store','pos') NOT NULL,
          `status` ENUM('pending','approved','completed','cancelled') NOT NULL DEFAULT 'completed',
          `note` VARCHAR(255) NULL DEFAULT NULL,
          `created_by` INT UNSIGNED NOT NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          `approved_by` INT UNSIGNED NULL DEFAULT NULL,
          `approved_at` DATETIME NULL DEFAULT NULL,
          `completed_by` INT UNSIGNED NULL DEFAULT NULL,
          `completed_at` DATETIME NULL DEFAULT NULL,
          `cancelled_by` INT UNSIGNED NULL DEFAULT NULL,
          `cancelled_at` DATETIME NULL DEFAULT NULL,
          PRIMARY KEY (`id`),
          KEY `idx_st_product` (`product_id`),
          KEY `idx_st_created` (`created_at`),
          KEY `idx_st_status` (`status`),
          CONSTRAINT `fk_st_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }
    if (!$has('stock_adjustments')) {
        $pdo->exec("CREATE TABLE IF NOT EXISTS `stock_adjustments` (
          `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
          `product_id` INT UNSIGNED NOT NULL,
          `variant_id` INT UNSIGNED NULL DEFAULT NULL,
          `location` ENUM('store','pos') NOT NULL,
          `quantity_change` DECIMAL(12,3) NOT NULL,
          `reason` VARCHAR(255) NOT NULL,
          `note` VARCHAR(500) NULL DEFAULT NULL,
          `adjusted_by` INT UNSIGNED NOT NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          KEY `idx_sa_product` (`product_id`),
          KEY `idx_sa_created` (`created_at`),
          CONSTRAINT `fk_sa_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    }

    if (!$has('farm_purchases')) {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS `farm_purchases` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `farm_name` VARCHAR(150) NULL DEFAULT NULL,
  `reference_no` VARCHAR(60) NULL DEFAULT NULL,
  `note` VARCHAR(255) NULL DEFAULT NULL,
  `allocation_method` ENUM('value','quantity') NOT NULL DEFAULT 'value',
  `purchase_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `admin_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `transport_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `landed_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `status` ENUM('active','cancelled') NOT NULL DEFAULT 'active',
  `received_by` INT UNSIGNED NOT NULL,
  `received_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_by` INT UNSIGNED NULL DEFAULT NULL,
  `cancelled_at` DATETIME NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fp_received` (`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL
);
    }
    if (!$has('farm_purchase_items')) {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS `farm_purchase_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NULL DEFAULT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit` VARCHAR(20) NULL DEFAULT NULL,
  `unit_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `purchase_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `alloc_admin` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `alloc_transport` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `landed_total` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `landed_unit_cost` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  PRIMARY KEY (`id`),
  KEY `idx_fpi_purchase` (`purchase_id`),
  KEY `idx_fpi_product` (`product_id`),
  CONSTRAINT `fk_fpi_purchase` FOREIGN KEY (`purchase_id`) REFERENCES `farm_purchases` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fpi_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL
);
    }
    if (!$has('farm_purchase_expenses')) {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS `farm_purchase_expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_id` INT UNSIGNED NOT NULL,
  `category` ENUM('transport','tax','storage','loading','other') NOT NULL DEFAULT 'other',
  `description` VARCHAR(150) NULL DEFAULT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fpe_purchase` (`purchase_id`),
  CONSTRAINT `fk_fpe_purchase` FOREIGN KEY (`purchase_id`) REFERENCES `farm_purchases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL
);
    }
    if (!$has('stock_costs')) {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS `stock_costs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `location` ENUM('store','pos') NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `unit_cost` DECIMAL(14,4) NOT NULL DEFAULT 0.0000,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_stock_cost` (`location`, `product_id`, `variant_id`),
  CONSTRAINT `fk_stock_costs_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL
);
    }
    if (!$has('stock_transfer_costs')) {
        $pdo->exec(<<<'SQL'
CREATE TABLE IF NOT EXISTS `stock_transfer_costs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transfer_id` INT UNSIGNED NOT NULL,
  `activity` VARCHAR(150) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_stc_transfer` (`transfer_id`),
  CONSTRAINT `fk_stc_transfer` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
SQL
);
    }

    // Unit (kg / bag) of each product bought from the farm
    if ($has('farm_purchase_items') && !$pdo->query("SHOW COLUMNS FROM farm_purchase_items LIKE 'unit'")->fetchColumn()) {
        $pdo->exec("ALTER TABLE farm_purchase_items ADD COLUMN `unit` VARCHAR(20) NULL DEFAULT NULL AFTER `quantity`");
    }

    // Costing columns on transfers (processing on the way to the shop + cost snapshot)
    $transferCols = [
        'output_product_id' => 'INT UNSIGNED NULL DEFAULT NULL',
        'output_variant_id' => 'INT UNSIGNED NULL DEFAULT NULL',
        'output_quantity'   => 'DECIMAL(12,3) NULL DEFAULT NULL',
        'processing_cost'   => 'DECIMAL(14,2) NOT NULL DEFAULT 0.00',
        'unit_cost'         => 'DECIMAL(14,4) NULL DEFAULT NULL',
        'input_cost'        => 'DECIMAL(14,2) NULL DEFAULT NULL',
        'total_cost'        => 'DECIMAL(14,2) NULL DEFAULT NULL',
        'output_unit_cost'  => 'DECIMAL(14,4) NULL DEFAULT NULL',
    ];
    foreach ($transferCols as $col => $def) {
        if (!$pdo->query("SHOW COLUMNS FROM stock_transfers LIKE '$col'")->fetchColumn()) {
            $pdo->exec("ALTER TABLE stock_transfers ADD COLUMN `$col` $def");
        }
    }

    // Damage records: where the damage happened + extra notes. Existing records were taken
    // from the one stock that existed before (the shop), so they become 'pos'.
    if (!$pdo->query("SHOW COLUMNS FROM damages LIKE 'notes'")->fetchColumn()) {
        $pdo->exec("ALTER TABLE damages ADD COLUMN `notes` VARCHAR(500) NULL DEFAULT NULL AFTER `reason`");
    }
    if (!$pdo->query("SHOW COLUMNS FROM damages LIKE 'location'")->fetchColumn()) {
        $pdo->exec("ALTER TABLE damages ADD COLUMN `location` ENUM('store','pos') NOT NULL DEFAULT 'pos' AFTER `notes`");
    }

    $done = true;
}

/* =========================================================
   Products / types  (an "item" = a type, or a product that has no types)
   ========================================================= */

/**
 * Validates the product (+ type) chosen on a form.
 * Returns ['product'=>row, 'variant'=>row|null, 'variant_id'=>int|null, 'key'=>int (0 when no type),
 *          'label'=>string, 'unit'=>string]. Responds with an error and stops when invalid.
 */
function resolve_stock_item(PDO $pdo, $productId, $variantId): array
{
    $productId = (int)$productId;
    $variantId = $variantId ? (int)$variantId : 0;
    if ($productId <= 0) respond(false, null, 'Please select a product.', 422);

    $stmt = $pdo->prepare('SELECT * FROM products WHERE id = ?');
    $stmt->execute([$productId]);
    $product = $stmt->fetch();
    if (!$product) respond(false, null, 'Product not found.', 404);

    $cnt = $pdo->prepare('SELECT COUNT(*) FROM product_variants WHERE product_id = ?');
    $cnt->execute([$productId]);
    $hasVariants = (int)$cnt->fetchColumn() > 0;

    $variant = null;
    if ($hasVariants) {
        if (!$variantId) respond(false, null, 'Please select a type for "' . $product['name'] . '".', 422);
        $v = $pdo->prepare('SELECT * FROM product_variants WHERE id = ? AND product_id = ?');
        $v->execute([$variantId, $productId]);
        $variant = $v->fetch();
        if (!$variant) respond(false, null, 'That type of "' . $product['name'] . '" no longer exists.', 404);
    }

    return [
        'product'    => $product,
        'variant'    => $variant,
        'variant_id' => $variant ? (int)$variant['id'] : null,
        'key'        => $variant ? (int)$variant['id'] : 0,
        'label'      => $variant ? ($product['name'] . ' — ' . $variant['variant_name']) : $product['name'],
        'unit'       => $variant ? $variant['unit'] : $product['unit'],
    ];
}

/**
 * Rebuilds the "item" for a stored record (transfer, receipt ...) without erroring when the
 * type was removed later.
 */
function item_from_record(PDO $pdo, array $rec): array
{
    return resolve_stock_item($pdo, $rec['product_id'], $rec['variant_id'] ?? null);
}

/* =========================================================
   Stock quantity at a location
   ========================================================= */

/** Current quantity at a location. $lock = true locks the row for the running transaction. */
function stock_at(PDO $pdo, string $location, int $productId, int $variantKey, bool $lock = false): float
{
    $suffix = $lock ? ' FOR UPDATE' : '';
    if ($location === 'store') {
        $stmt = $pdo->prepare('SELECT quantity FROM store_stock WHERE product_id = ? AND variant_id = ?' . $suffix);
        $stmt->execute([$productId, $variantKey]);
        $q = $stmt->fetchColumn();
        return $q === false ? 0.0 : to_qty($q);
    }
    if ($variantKey > 0) {
        $stmt = $pdo->prepare('SELECT stock_quantity FROM product_variants WHERE id = ?' . $suffix);
        $stmt->execute([$variantKey]);
    } else {
        $stmt = $pdo->prepare('SELECT stock_quantity FROM products WHERE id = ?' . $suffix);
        $stmt->execute([$productId]);
    }
    $q = $stmt->fetchColumn();
    return $q === false ? 0.0 : to_qty($q);
}

/**
 * Adds ($delta > 0) or removes ($delta < 0) stock at ONE location, and only there.
 * Removing more than is available throws StockShortage (nothing is changed).
 * Call inside a transaction.
 */
function change_stock(PDO $pdo, string $location, int $productId, int $variantKey, float $delta, string $itemLabel = ''): float
{
    $delta = round($delta, 3);
    if ($location === 'store') {
        // make sure the row exists, then lock it
        $pdo->prepare('INSERT IGNORE INTO store_stock (product_id, variant_id, quantity) VALUES (?,?,0)')->execute([$productId, $variantKey]);
    }
    $current = stock_at($pdo, $location, $productId, $variantKey, true);
    $new = round($current + $delta, 3);
    if ($new < 0) {
        throw new StockShortage('Not enough stock' . ($itemLabel ? ' of "' . $itemLabel . '"' : '') . ' in the ' . location_label($location)
            . '. Available: ' . fmt_qty($current) . ', needed: ' . fmt_qty(abs($delta)) . '.');
    }

    if ($location === 'store') {
        $pdo->prepare('UPDATE store_stock SET quantity = ? WHERE product_id = ? AND variant_id = ?')->execute([$new, $productId, $variantKey]);
    } elseif ($variantKey > 0) {
        $pdo->prepare('UPDATE product_variants SET stock_quantity = ? WHERE id = ?')->execute([$new, $variantKey]);
    } else {
        $pdo->prepare('UPDATE products SET stock_quantity = ? WHERE id = ?')->execute([$new, $productId]);
    }
    return $new;
}

function valid_location($loc): bool
{
    return is_string($loc) && isset(STORE_LOCATIONS[$loc]);
}

/* =========================================================
   Date + time filtering
   ========================================================= */

/**
 * Works out the date range of a request: preset = today | yesterday | this_week | last_week |
 * this_month | last_month | custom (start/end) | all. Weeks run Monday to Sunday.
 * "Today" comes from the database clock, the same clock that stamps the records.
 * Optional time_from / time_to (HH:MM) narrow it to a time of day on each of those days.
 */
function store_range(PDO $pdo, array $q): array
{
    $today = new DateTimeImmutable((string)$pdo->query('SELECT CURDATE()')->fetchColumn());
    $preset = clean($q['preset'] ?? '');
    $start = null;
    $end = null;

    switch ($preset) {
        case 'today':      $start = $end = $today; break;
        case 'yesterday':  $start = $end = $today->modify('-1 day'); break;
        case 'this_week':
            $start = $today->modify('-' . ((int)$today->format('N') - 1) . ' days');
            $end = $start->modify('+6 days');
            break;
        case 'last_week':
            $thisMonday = $today->modify('-' . ((int)$today->format('N') - 1) . ' days');
            $start = $thisMonday->modify('-7 days');
            $end = $thisMonday->modify('-1 day');
            break;
        case 'this_month':
            $start = $today->modify('first day of this month');
            $end = $today->modify('last day of this month');
            break;
        case 'last_month':
            $start = $today->modify('first day of last month');
            $end = $today->modify('last day of last month');
            break;
        case 'all':
            break;
        default: // custom / no preset
            $preset = 'custom';
            $s = clean($q['start'] ?? '');
            $e = clean($q['end'] ?? '');
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $s)) $start = new DateTimeImmutable($s);
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $e)) $end = new DateTimeImmutable($e);
    }

    $tf = clean($q['time_from'] ?? '');
    $tt = clean($q['time_to'] ?? '');

    return [
        'preset'    => $preset,
        'start'     => $start ? $start->format('Y-m-d') : null,
        'end'       => $end ? $end->format('Y-m-d') : null,
        'time_from' => preg_match('/^\d{2}:\d{2}$/', $tf) ? $tf : null,
        'time_to'   => preg_match('/^\d{2}:\d{2}$/', $tt) ? $tt : null,
    ];
}

/**
 * SQL conditions (starting with " AND ") limiting a date-time expression to the range.
 * Values are appended to $params in order.
 */
function store_range_sql(string $tsExpr, array $range, array &$params): string
{
    $sql = '';
    if ($range['start']) { $sql .= " AND $tsExpr >= ?"; $params[] = $range['start'] . ' 00:00:00'; }
    if ($range['end'])   { $sql .= " AND $tsExpr <= ?"; $params[] = $range['end'] . ' 23:59:59'; }

    $tf = $range['time_from'];
    $tt = $range['time_to'];
    if ($tf && $tt) {
        if ($tf <= $tt) {
            $sql .= " AND TIME($tsExpr) BETWEEN ? AND ?";
        } else { // an overnight window, e.g. 22:00 - 06:00
            $sql .= " AND (TIME($tsExpr) >= ? OR TIME($tsExpr) <= ?)";
        }
        $params[] = $tf . ':00';
        $params[] = $tt . ':59';
    } elseif ($tf) {
        $sql .= " AND TIME($tsExpr) >= ?"; $params[] = $tf . ':00';
    } elseif ($tt) {
        $sql .= " AND TIME($tsExpr) <= ?"; $params[] = $tt . ':59';
    }
    return $sql;
}

/* =========================================================
   The complete inventory movement history
   ========================================================= */

/**
 * One list of every stock movement at every location.
 * Columns: ts, mtype, location, product_id, variant_id (0 = none), qty (signed: + adds, - removes),
 *          user_id, ref, note.
 *
 * mtype: farm_receipt, receipt_reversal, transfer_out, transfer_in, transfer_reversal,
 *        damage, adjustment, sale, purchase.
 *
 * Sales, purchases and damages are read from their own tables, so editing or deleting
 * one of them is reflected here automatically.
 */
function movements_union_sql(): string
{
    $destLabel = "IF(%s = 'store', 'Main Store', 'POS / Shop')";
    $toNote   = "CONCAT('To ', " . sprintf($destLabel, 't.destination') . ", IFNULL(CONCAT(' · ', NULLIF(t.note, '')), ''))";
    $fromNote = "CONCAT('From ', " . sprintf($destLabel, 't.source') . ", IFNULL(CONCAT(' · ', NULLIF(t.note, '')), ''))";

    return "
    SELECT fr.received_at AS ts, 'farm_receipt' AS mtype, 'store' AS location, fr.product_id, COALESCE(fr.variant_id, 0) AS variant_id,
           fr.quantity AS qty, fr.received_by AS user_id, CONCAT('RCV-', LPAD(fr.id, 5, '0')) AS ref,
           CONCAT_WS(' · ', NULLIF(fr.farm_name, ''), NULLIF(fr.reference_no, ''), NULLIF(fr.note, '')) AS note
      FROM farm_receipts fr
    UNION ALL
    SELECT fr.cancelled_at, 'receipt_reversal', 'store', fr.product_id, COALESCE(fr.variant_id, 0),
           -fr.quantity, fr.cancelled_by, CONCAT('RCV-', LPAD(fr.id, 5, '0')), 'Farm receipt cancelled'
      FROM farm_receipts fr WHERE fr.status = 'cancelled' AND fr.cancelled_at IS NOT NULL
    UNION ALL
    SELECT fp.received_at, 'farm_receipt', 'store', fi.product_id, COALESCE(fi.variant_id, 0), fi.quantity, fp.received_by,
           CONCAT('PUR-', LPAD(fp.id, 5, '0')), CONCAT_WS(' · ', NULLIF(fp.farm_name, ''), NULLIF(fp.reference_no, ''), NULLIF(fp.note, ''))
      FROM farm_purchase_items fi JOIN farm_purchases fp ON fp.id = fi.purchase_id
    UNION ALL
    SELECT fp.cancelled_at, 'receipt_reversal', 'store', fi.product_id, COALESCE(fi.variant_id, 0), -fi.quantity, fp.cancelled_by,
           CONCAT('PUR-', LPAD(fp.id, 5, '0')), 'Farm purchase cancelled'
      FROM farm_purchase_items fi JOIN farm_purchases fp ON fp.id = fi.purchase_id
     WHERE fp.status = 'cancelled' AND fp.cancelled_at IS NOT NULL
    UNION ALL
    SELECT t.completed_at, 'transfer_out', t.source, t.product_id, COALESCE(t.variant_id, 0),
           -t.quantity, COALESCE(t.completed_by, t.created_by), CONCAT('TRF-', LPAD(t.id, 5, '0')), $toNote
      FROM stock_transfers t WHERE t.completed_at IS NOT NULL
    UNION ALL
    SELECT t.completed_at, 'transfer_in', t.destination, COALESCE(t.output_product_id, t.product_id),
           IF(t.output_product_id IS NULL, COALESCE(t.variant_id, 0), COALESCE(t.output_variant_id, 0)),
           COALESCE(t.output_quantity, t.quantity), COALESCE(t.completed_by, t.created_by), CONCAT('TRF-', LPAD(t.id, 5, '0')),
           IF(t.output_product_id IS NULL, $fromNote, CONCAT('Processed from ', (SELECT p0.name FROM products p0 WHERE p0.id = t.product_id), IFNULL(CONCAT(' · ', NULLIF(t.note, '')), '')))
      FROM stock_transfers t WHERE t.completed_at IS NOT NULL
    UNION ALL
    SELECT t.cancelled_at, 'transfer_reversal', t.destination, COALESCE(t.output_product_id, t.product_id),
           IF(t.output_product_id IS NULL, COALESCE(t.variant_id, 0), COALESCE(t.output_variant_id, 0)),
           -COALESCE(t.output_quantity, t.quantity), t.cancelled_by, CONCAT('TRF-', LPAD(t.id, 5, '0')), 'Completed transfer cancelled (stock returned)'
      FROM stock_transfers t WHERE t.status = 'cancelled' AND t.completed_at IS NOT NULL AND t.cancelled_at IS NOT NULL
    UNION ALL
    SELECT t.cancelled_at, 'transfer_reversal', t.source, t.product_id, COALESCE(t.variant_id, 0),
           t.quantity, t.cancelled_by, CONCAT('TRF-', LPAD(t.id, 5, '0')), 'Completed transfer cancelled (stock returned)'
      FROM stock_transfers t WHERE t.status = 'cancelled' AND t.completed_at IS NOT NULL AND t.cancelled_at IS NOT NULL
    UNION ALL
    SELECT TIMESTAMP(d.damage_date, TIME(d.created_at)), 'damage', d.location, d.product_id, COALESCE(d.variant_id, 0),
           -d.quantity, d.recorded_by, CONCAT('DMG-', LPAD(d.id, 5, '0')),
           CONCAT_WS(' · ', NULLIF(d.reason, ''), NULLIF(d.notes, ''))
      FROM damages d WHERE d.item_type = 'product' AND d.product_id IS NOT NULL AND d.quantity IS NOT NULL
    UNION ALL
    SELECT st.created_at, 'sale', 'pos', si.product_id, COALESCE(si.variant_id, 0),
           -si.quantity, st.sold_by, CONCAT('Sale #', st.id), NULLIF(st.customer_name, '')
      FROM sale_items si JOIN sale_transactions st ON st.id = si.transaction_id
    UNION ALL
    SELECT TIMESTAMP(pu.purchase_date, TIME(pu.created_at)), 'purchase', 'pos', pu.product_id, COALESCE(pu.variant_id, 0),
           pu.quantity, pu.recorded_by, CONCAT('Purchase #', pu.id), NULLIF(pu.note, '')
      FROM purchases pu
    UNION ALL
    SELECT sa.created_at, 'adjustment', sa.location, sa.product_id, COALESCE(sa.variant_id, 0),
           sa.quantity_change, sa.adjusted_by, CONCAT('ADJ-', LPAD(sa.id, 5, '0')),
           CONCAT_WS(' · ', NULLIF(sa.reason, ''), NULLIF(sa.note, ''))
      FROM stock_adjustments sa";
}

const MOVEMENT_TYPES = [
    'farm_receipt', 'receipt_reversal', 'transfer_out', 'transfer_in', 'transfer_reversal',
    'damage', 'adjustment', 'sale', 'purchase',
];

/**
 * WHERE part (starting with "WHERE 1=1") for queries over (movements_union_sql()) AS mv.
 * Filters: date/time range, product_id, user_id, location, type.
 */
function movements_where(array $range, array $q, array &$params): string
{
    $where = 'WHERE mv.ts IS NOT NULL';
    $where .= store_range_sql('mv.ts', $range, $params);
    if (!empty($q['product_id'])) { $where .= ' AND mv.product_id = ?'; $params[] = (int)$q['product_id']; }
    if (!empty($q['user_id']))    { $where .= ' AND mv.user_id = ?';    $params[] = (int)$q['user_id']; }
    if (!empty($q['location']) && valid_location($q['location'])) { $where .= ' AND mv.location = ?'; $params[] = $q['location']; }
    if (!empty($q['type']) && in_array($q['type'], MOVEMENT_TYPES, true)) { $where .= ' AND mv.mtype = ?'; $params[] = $q['type']; }
    return $where;
}

/** All active products and types with their main-store and POS/shop quantity. */
function stock_items_sql(bool $activeOnly): string
{
    $pa = $activeOnly ? " AND p.status = 'active'" : '';
    $va = $activeOnly ? " AND pv.status = 'active'" : '';
    return "
    SELECT p.id AS product_id, 0 AS variant_id, p.name AS label, p.name AS product_name, p.unit AS unit,
           p.stock_quantity AS pos_qty, COALESCE(ss.quantity, 0) AS store_qty, p.reorder_level AS reorder_level, p.status AS status,
           p.buying_price AS buying_price, p.selling_price AS selling_price
      FROM products p
      LEFT JOIN store_stock ss ON ss.product_id = p.id AND ss.variant_id = 0
     WHERE NOT EXISTS (SELECT 1 FROM product_variants x WHERE x.product_id = p.id) $pa
    UNION ALL
    SELECT p.id, pv.id, CONCAT(p.name, ' — ', pv.variant_name), p.name, pv.unit,
           pv.stock_quantity, COALESCE(ss.quantity, 0), pv.reorder_level, IF(p.status = 'active' AND pv.status = 'active', 'active', 'disabled'),
           pv.buying_price, pv.selling_price
      FROM product_variants pv
      JOIN products p ON p.id = pv.product_id
      LEFT JOIN store_stock ss ON ss.product_id = p.id AND ss.variant_id = pv.id
     WHERE 1=1 $pa $va";
}


/* =========================================================
   COSTING - the true (landed) cost of stock
   =========================================================
   Purchase price + shared expenses (transport, taxes ...) + processing = cost.
   Each location keeps an average cost per unit (stock_costs). Stock that moves carries its cost
   with it, so the cost of a product at the shop already includes everything spent on the way.
   Stock without a recorded cost (older stock) is valued at the product's buying price. */

const SHARED_EXPENSE_CATEGORIES = ['transport', 'tax', 'storage', 'loading', 'other'];

/** Average cost per unit of the stock at a location. 'estimated' = no cost recorded yet, buying price used. */
function unit_cost_of(PDO $pdo, string $location, int $productId, int $variantKey): array
{
    $stmt = $pdo->prepare('SELECT unit_cost FROM stock_costs WHERE location = ? AND product_id = ? AND variant_id = ?');
    $stmt->execute([$location, $productId, $variantKey]);
    $c = $stmt->fetchColumn();
    if ($c !== false) return ['cost' => (float)$c, 'estimated' => false];

    if ($variantKey > 0) {
        $stmt = $pdo->prepare('SELECT buying_price FROM product_variants WHERE id = ?');
        $stmt->execute([$variantKey]);
    } else {
        $stmt = $pdo->prepare('SELECT buying_price FROM products WHERE id = ?');
        $stmt->execute([$productId]);
    }
    return ['cost' => (float)$stmt->fetchColumn(), 'estimated' => true];
}

/**
 * Adds stock at a location AND blends its cost into the location's average cost.
 * (old qty x old cost + new qty x new cost) / total qty. Call inside a transaction.
 */
function add_costed_stock(PDO $pdo, string $location, int $productId, int $variantKey, float $qty, float $unitCost, string $label = ''): void
{
    if ($location === 'store') {
        $pdo->prepare('INSERT IGNORE INTO store_stock (product_id, variant_id, quantity) VALUES (?,?,0)')->execute([$productId, $variantKey]);
    }
    $current = stock_at($pdo, $location, $productId, $variantKey, true);
    $oldCost = unit_cost_of($pdo, $location, $productId, $variantKey)['cost'];
    $total = $current + $qty;
    $newCost = $total > 0 ? (($current * $oldCost) + ($qty * $unitCost)) / $total : $unitCost;

    change_stock($pdo, $location, $productId, $variantKey, $qty, $label);
    $pdo->prepare('INSERT INTO stock_costs (location, product_id, variant_id, unit_cost) VALUES (?,?,?,?)
                   ON DUPLICATE KEY UPDATE unit_cost = VALUES(unit_cost)')
        ->execute([$location, $productId, $variantKey, round($newCost, 4)]);
}

/**
 * Spreads the shared expenses over the purchased products.
 * $method: 'value' (by purchase value) or 'quantity'. Transport and the other (administrative) expenses
 * are allocated separately so each can be reported. The last line takes the rounding remainder.
 * $lines: list of ['quantity' => .., 'purchase_total' => ..]. Returns a list of ['alloc_admin', 'alloc_transport'].
 */
function allocate_shared_costs(array $lines, float $adminTotal, float $transportTotal, string $method): array
{
    $weights = [];
    foreach ($lines as $l) $weights[] = $method === 'quantity' ? (float)$l['quantity'] : (float)$l['purchase_total'];
    $sum = array_sum($weights);
    if ($sum <= 0) { // every price is 0 - fall back to quantity
        $weights = array_map(fn($l) => (float)$l['quantity'], $lines);
        $sum = array_sum($weights);
    }
    $n = count($lines);
    $remA = round($adminTotal, 2);
    $remT = round($transportTotal, 2);
    $out = [];
    foreach ($lines as $i => $_) {
        if ($i === $n - 1) {
            $a = $remA; $t = $remT;
        } else {
            $a = round($adminTotal * $weights[$i] / $sum, 2);
            $t = round($transportTotal * $weights[$i] / $sum, 2);
            $remA = round($remA - $a, 2);
            $remT = round($remT - $t, 2);
        }
        $out[] = ['alloc_admin' => $a, 'alloc_transport' => $t];
    }
    return $out;
}

/**
 * Moves the stock of a transfer and carries its cost along. Used when a transfer is completed.
 * Plain transfer: the stock keeps its unit cost. With processing: cost of the stock used + processing
 * expenses is divided over the finished quantity (so processing loss raises the cost per unit).
 * Records the cost snapshot on the transfer. Call inside a transaction; may throw StockShortage.
 */
function complete_transfer_stock(PDO $pdo, array $t): void
{
    $item = item_from_record($pdo, $t);
    $outItem = !empty($t['output_product_id'])
        ? resolve_stock_item($pdo, $t['output_product_id'], $t['output_variant_id'] ?? null)
        : $item;
    $qtyIn = to_qty($t['quantity']);
    $qtyOut = !empty($t['output_quantity']) ? to_qty($t['output_quantity']) : $qtyIn;
    $pid = (int)$t['product_id'];

    $uc = unit_cost_of($pdo, $t['source'], $pid, $item['key'])['cost'];
    change_stock($pdo, $t['source'], $pid, $item['key'], -$qtyIn, $item['label']);

    $inputCost = round($qtyIn * $uc, 2);
    $total = round($inputCost + (float)$t['processing_cost'], 2);
    $outUnit = $qtyOut > 0 ? round($total / $qtyOut, 4) : 0;
    add_costed_stock($pdo, $t['destination'], (int)$outItem['product']['id'], $outItem['key'], $qtyOut, $outUnit, $outItem['label']);

    $pdo->prepare('UPDATE stock_transfers SET unit_cost = ?, input_cost = ?, total_cost = ?, output_unit_cost = ? WHERE id = ?')
        ->execute([round($uc, 4), $inputCost, $total, $outUnit, $t['id']]);
}

/** Undoes complete_transfer_stock (cancelling a completed transfer). May throw StockShortage. */
function reverse_transfer_stock(PDO $pdo, array $t): void
{
    $item = item_from_record($pdo, $t);
    $outItem = !empty($t['output_product_id'])
        ? resolve_stock_item($pdo, $t['output_product_id'], $t['output_variant_id'] ?? null)
        : $item;
    $qtyIn = to_qty($t['quantity']);
    $qtyOut = !empty($t['output_quantity']) ? to_qty($t['output_quantity']) : $qtyIn;
    $pid = (int)$t['product_id'];

    change_stock($pdo, $t['destination'], (int)$outItem['product']['id'], $outItem['key'], -$qtyOut, $outItem['label']);
    $uc = $t['unit_cost'] !== null ? (float)$t['unit_cost'] : unit_cost_of($pdo, $t['source'], $pid, $item['key'])['cost'];
    add_costed_stock($pdo, $t['source'], $pid, $item['key'], $qtyIn, $uc, $item['label']);
}

/** Removes cost columns for people who may not see money (workers). */
function strip_cost_fields(array $row, array $fields): array
{
    foreach ($fields as $f) unset($row[$f]);
    return $row;
}
