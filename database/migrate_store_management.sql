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

