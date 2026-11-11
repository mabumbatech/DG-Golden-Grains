-- =========================================================
-- GOLDEN GRAINS - Store Management upgrade (for an EXISTING installation)
-- The system also applies this automatically the first time the Store page or
-- the Damages page is opened, so running it by hand is optional.
-- (If your MySQL version does not support ADD COLUMN IF NOT EXISTS, skip the two
--  ALTER lines when the columns already exist.)
-- =========================================================
ALTER TABLE `damages` ADD COLUMN IF NOT EXISTS `notes` VARCHAR(500) NULL DEFAULT NULL AFTER `reason`;
ALTER TABLE `damages` ADD COLUMN IF NOT EXISTS `location` ENUM('store','pos') NOT NULL DEFAULT 'pos' AFTER `notes`;

-- ---------------------------------------------------------
-- STORE MANAGEMENT & STOCK MOVEMENT TRACKING
-- Journey of a product:  Farm -> Main Store (warehouse) -> POS / Shop -> Customer.
--   * POS/shop stock stays in product_variants.stock_quantity (or products.stock_quantity
--     for a product without types) - exactly what Sales already uses.
--   * Main store stock is kept separately in store_stock.
-- ---------------------------------------------------------

-- Table: store_stock - quantity of each product/type currently in the main store.
-- variant_id = 0 means "the product itself" (a product without types).
CREATE TABLE IF NOT EXISTS `store_stock` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NOT NULL DEFAULT 0,
  `quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_store_item` (`product_id`, `variant_id`),
  CONSTRAINT `fk_store_stock_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: farm_receipts - stock received from the farm into the main store.
CREATE TABLE IF NOT EXISTS `farm_receipts` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: stock_transfers - movement of stock between the main store and the POS/shop.
-- Stock only moves when a transfer is Completed.
CREATE TABLE IF NOT EXISTS `stock_transfers` (
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
  `output_product_id` INT UNSIGNED NULL DEFAULT NULL COMMENT 'finished product when the stock is processed on the way to the shop',
  `output_variant_id` INT UNSIGNED NULL DEFAULT NULL,
  `output_quantity` DECIMAL(12,3) NULL DEFAULT NULL COMMENT 'quantity after processing',
  `processing_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `unit_cost` DECIMAL(14,4) NULL DEFAULT NULL COMMENT 'cost per unit of the stock that left the source',
  `input_cost` DECIMAL(14,2) NULL DEFAULT NULL,
  `total_cost` DECIMAL(14,2) NULL DEFAULT NULL COMMENT 'input cost + processing cost',
  `output_unit_cost` DECIMAL(14,4) NULL DEFAULT NULL COMMENT 'final cost per unit of what arrived',
  PRIMARY KEY (`id`),
  KEY `idx_st_product` (`product_id`),
  KEY `idx_st_created` (`created_at`),
  KEY `idx_st_status` (`status`),
  CONSTRAINT `fk_st_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: stock_adjustments - manual corrections (stock count differences etc.) at one location.
-- quantity_change is signed: positive adds stock, negative removes it.
CREATE TABLE IF NOT EXISTS `stock_adjustments` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- COSTING: true landed cost of stock (purchase price + shared expenses + processing)
-- ---------------------------------------------------------

-- Table: farm_purchases - ONE purchasing transaction from the farm (may contain many products).
-- Shared expenses (transport, taxes ...) are recorded once here, then spread over the products.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: farm_purchase_items - each product keeps its own price and its own share of the shared expenses.
CREATE TABLE IF NOT EXISTS `farm_purchase_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NULL DEFAULT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit` VARCHAR(20) NULL DEFAULT NULL COMMENT 'kg or bag, as bought from the farm',
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: farm_purchase_expenses - the shared expense entries of one purchasing transaction.
CREATE TABLE IF NOT EXISTS `farm_purchase_expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `purchase_id` INT UNSIGNED NOT NULL,
  `category` ENUM('transport','tax','storage','loading','other') NOT NULL DEFAULT 'other',
  `description` VARCHAR(150) NULL DEFAULT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fpe_purchase` (`purchase_id`),
  CONSTRAINT `fk_fpe_purchase` FOREIGN KEY (`purchase_id`) REFERENCES `farm_purchases` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: stock_costs - current average actual cost per unit of the stock at each location.
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Table: stock_transfer_costs - preparation / processing expenses entered while moving stock store -> shop.
CREATE TABLE IF NOT EXISTS `stock_transfer_costs` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transfer_id` INT UNSIGNED NOT NULL,
  `activity` VARCHAR(150) NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_stc_transfer` (`transfer_id`),
  CONSTRAINT `fk_stc_transfer` FOREIGN KEY (`transfer_id`) REFERENCES `stock_transfers` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Costing columns on existing transfers (skip these lines if the columns already exist)
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `output_product_id` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `output_variant_id` INT UNSIGNED NULL DEFAULT NULL;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `output_quantity` DECIMAL(12,3) NULL DEFAULT NULL;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `processing_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `unit_cost` DECIMAL(14,4) NULL DEFAULT NULL;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `input_cost` DECIMAL(14,2) NULL DEFAULT NULL;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `total_cost` DECIMAL(14,2) NULL DEFAULT NULL;
ALTER TABLE `stock_transfers` ADD COLUMN IF NOT EXISTS `output_unit_cost` DECIMAL(14,4) NULL DEFAULT NULL;
ALTER TABLE `farm_purchase_items` ADD COLUMN IF NOT EXISTS `unit` VARCHAR(20) NULL DEFAULT NULL;
