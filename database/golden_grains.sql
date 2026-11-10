-- =========================================================
-- GOLDEN GRAINS  -  Business Management System
-- Complete database schema (all tables, final version).
--
-- Import with phpMyAdmin, or let backend/install.php do it for you.
-- Database name used by default: golden_grains
-- =========================================================
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------
-- Table: users
-- Admins and Workers. First admin is created by install.php
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `full_name` VARCHAR(120) NOT NULL,
  `username` VARCHAR(60) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('admin','worker') NOT NULL DEFAULT 'worker',
  `security_question` VARCHAR(255) NOT NULL,
  `security_answer_hash` VARCHAR(255) NOT NULL,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: categories
-- Product categories (Rice, Flour, Cooking Oil, Beans, Maize ...)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `categories` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_cat_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: products
-- Every item the shop sells is a product with stock tracking.
-- Each product has one or more types/sizes in product_variants
-- (e.g. Rice - Kyela 25kg, Rice - Kyela 5kg), which carry the
-- real prices and stock. stock_quantity / reorder_level can have decimals (e.g. 2.5 kg).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `products` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NOT NULL,
  `category_id` INT UNSIGNED NULL,
  `unit` VARCHAR(30) NOT NULL DEFAULT 'kg',
  `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `selling_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `minimum_price` DECIMAL(12,2) NULL DEFAULT NULL,
  `stock_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `reorder_level` DECIMAL(12,3) NOT NULL DEFAULT 5.000,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_prod_category` (`category_id`),
  CONSTRAINT `fk_prod_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: customers
-- One row per real customer, matched by phone when given, otherwise
-- by name. A sale with neither name nor phone creates no customer row.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `customers` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(150) NULL,
  `phone` VARCHAR(30) NULL,
  `status` ENUM('active','restricted') NOT NULL DEFAULT 'active',
  `restricted_at` DATETIME NULL DEFAULT NULL,
  `restricted_reason` VARCHAR(255) NULL DEFAULT NULL,
  `restriction_overridden_by` INT UNSIGNED NULL DEFAULT NULL,
  `first_purchase_date` DATE NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_customer_phone` (`phone`),
  KEY `idx_customer_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: sale_transactions
-- One row per checkout/receipt (the customer, payment method, and
-- grand total). A transaction has one or more sale_items.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sale_transactions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `customer_id` INT UNSIGNED NULL DEFAULT NULL,
  `customer_name` VARCHAR(150) NULL DEFAULT NULL,
  `customer_phone` VARCHAR(30) NULL DEFAULT NULL,
  `payment_method` ENUM('cash','credit') NOT NULL DEFAULT 'cash',
  `cash_type` ENUM('cash_in_hand','online') NULL DEFAULT NULL,
  `online_method` VARCHAR(50) NULL DEFAULT NULL,
  `credit_deadline` DATE NULL DEFAULT NULL,
  `total_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_profit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `change_amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'change the customer left behind on this sale (business owes the customer)',
  `note` VARCHAR(255) NULL DEFAULT NULL,
  `sold_by` INT UNSIGNED NOT NULL,
  `sale_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_txn_customer` (`customer_id`),
  KEY `fk_txn_user` (`sold_by`),
  KEY `idx_txn_date` (`sale_date`),
  CONSTRAINT `fk_txn_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_txn_user` FOREIGN KEY (`sold_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: sale_items
-- One row per product within a sale_transactions row.
-- quantity can have decimals (e.g. 2.5 kg).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sale_items` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_id` INT UNSIGNED NOT NULL,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NULL DEFAULT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `unit_price` DECIMAL(14,2) NOT NULL,
  `buying_price` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `subtotal` DECIMAL(14,2) NOT NULL,
  `profit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (`id`),
  KEY `fk_item_txn` (`transaction_id`),
  KEY `fk_item_product` (`product_id`),
  CONSTRAINT `fk_item_txn` FOREIGN KEY (`transaction_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: debt_payments
-- Repayments made against a sale_transactions row recorded on credit.
-- Remaining balance = sale_transactions.total_amount - SUM(debt_payments.amount).
-- sale_id correctly references sale_transactions (this is the FK
-- that was previously left pointing at a renamed legacy table).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `debt_payments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sale_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `method` ENUM('cash_in_hand','online') NOT NULL DEFAULT 'cash_in_hand',
  `online_method` VARCHAR(50) NULL DEFAULT NULL,
  `payment_date` DATE NOT NULL,
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_debt_sale` (`sale_id`),
  KEY `fk_debt_user` (`recorded_by`),
  CONSTRAINT `fk_debt_sale` FOREIGN KEY (`sale_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_debt_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: expenses
-- Electricity, food, rent, transport, etc.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `expenses` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(150) NOT NULL,
  `category` VARCHAR(80) NOT NULL DEFAULT 'General',
  `amount` DECIMAL(14,2) NOT NULL,
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `expense_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_exp_user` (`recorded_by`),
  KEY `idx_exp_date` (`expense_date`),
  CONSTRAINT `fk_exp_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: damages
-- Wasted / spoiled / mistakenly used stock (e.g. rim of paper), OR
-- a non-stock item (equipment, material, furniture, etc.) that got
-- damaged. item_type = 'product' uses product_id + quantity and the
-- loss is calculated from the product's buying price. item_type =
-- 'other' uses item_name + manual_cost, entered by hand, since there
-- is no stock record to calculate a loss value from. quantity is a
-- whole number.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `damages` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NULL,
  `variant_id` INT UNSIGNED NULL DEFAULT NULL,
  `item_type` ENUM('product','other') NOT NULL DEFAULT 'product',
  `item_name` VARCHAR(150) NULL DEFAULT NULL,
  `quantity` DECIMAL(12,3) NULL DEFAULT NULL,
  `reason` VARCHAR(255) NOT NULL,
  `notes` VARCHAR(500) NULL DEFAULT NULL,
  `location` ENUM('store','pos') NOT NULL DEFAULT 'pos' COMMENT 'where the stock was damaged: main store or POS/shop',
  `loss_value` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `manual_cost` DECIMAL(14,2) NULL DEFAULT NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `damage_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_dmg_product` (`product_id`),
  KEY `fk_dmg_user` (`recorded_by`),
  KEY `idx_dmg_date` (`damage_date`),
  CONSTRAINT `fk_dmg_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_dmg_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: purchases
-- Stock received - either added one at a time, or imported in bulk
-- from a supplier's Excel/CSV list. Increases product stock_quantity.
-- quantity can have decimals (e.g. 2.5 kg).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `purchases` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_id` INT UNSIGNED NULL DEFAULT NULL,
  `quantity` DECIMAL(12,3) NOT NULL,
  `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `total_cost` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `source` ENUM('manual','import') NOT NULL DEFAULT 'manual',
  `note` VARCHAR(255) NULL,
  `recorded_by` INT UNSIGNED NOT NULL,
  `purchase_date` DATE NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_pur_product` (`product_id`),
  KEY `fk_pur_user` (`recorded_by`),
  KEY `idx_pur_date` (`purchase_date`),
  CONSTRAINT `fk_pur_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pur_user` FOREIGN KEY (`recorded_by`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: settings
-- Key/value store, e.g. shop name, install lock flag
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key` VARCHAR(60) NOT NULL,
  `setting_value` VARCHAR(255) NOT NULL,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: audit_log
-- Who created, edited, or deleted what, and when. user_id/user_name/
-- user_role are stored as plain values (no FK to users) so the trail
-- survives even if that user's account is later deleted.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `audit_log` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `user_name` VARCHAR(150) NOT NULL,
  `user_role` VARCHAR(20) NOT NULL,
  `action` VARCHAR(20) NOT NULL,
  `entity_type` VARCHAR(30) NOT NULL,
  `entity_id` INT UNSIGNED NULL,
  `description` VARCHAR(500) NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_entity` (`entity_type`, `entity_id`),
  KEY `idx_audit_created` (`created_at`),
  KEY `idx_audit_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


-- ---------------------------------------------------------
-- Table: product_variants
-- The types / sizes of a product. They carry the real buying price,
-- selling price, minimum price, unit and stock.
-- e.g. Rice (product) -> "Kyela 25kg", "Kyela 5kg" (types).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `product_variants` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `product_id` INT UNSIGNED NOT NULL,
  `variant_name` VARCHAR(150) NOT NULL,
  `unit` VARCHAR(30) NOT NULL DEFAULT 'kg',
  `buying_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `selling_price` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  `minimum_price` DECIMAL(12,2) NULL DEFAULT NULL,
  `stock_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  `reorder_level` DECIMAL(12,3) NOT NULL DEFAULT 5.000,
  `status` ENUM('active','disabled') NOT NULL DEFAULT 'active',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_variant_product` (`product_id`),
  UNIQUE KEY `uniq_variant_per_product` (`product_id`, `variant_name`),
  CONSTRAINT `fk_variant_product` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- variant_id links (deleting a type never deletes history: the row keeps the parent product)
ALTER TABLE `sale_items`
  ADD KEY `fk_item_variant` (`variant_id`),
  ADD CONSTRAINT `fk_item_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL;

ALTER TABLE `purchases`
  ADD KEY `fk_purchase_variant` (`variant_id`),
  ADD CONSTRAINT `fk_purchase_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL;

ALTER TABLE `damages`
  ADD KEY `fk_damage_variant` (`variant_id`),
  ADD CONSTRAINT `fk_damage_variant` FOREIGN KEY (`variant_id`) REFERENCES `product_variants` (`id`) ON DELETE SET NULL;

-- ---------------------------------------------------------
-- Table: sale_change_collections
-- Each time a customer collects (part of) the change they left behind
-- on a sale. Not a sale and not a debt - only the collection history.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sale_change_collections` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `sale_id` INT UNSIGNED NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL,
  `collected_date` DATE NOT NULL,
  `note` VARCHAR(255) NULL DEFAULT NULL,
  `recorded_by` INT UNSIGNED NULL DEFAULT NULL,
  `recorded_by_name` VARCHAR(100) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_scc_sale` (`sale_id`),
  KEY `idx_scc_date` (`collected_date`),
  CONSTRAINT `fk_scc_sale` FOREIGN KEY (`sale_id`) REFERENCES `sale_transactions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: cash_audits
-- Saved Cash Audit sheets (history).
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cash_audits` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `audit_date` DATE NOT NULL,
  `cashier` VARCHAR(80) NOT NULL DEFAULT '',
  `shift` VARCHAR(40) NOT NULL DEFAULT '',
  `opening_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `cash_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `electronic_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `credit_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `total_sales` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `expenses` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `counted_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `expected_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `variance` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `note` TEXT NULL,
  `denominations` TEXT NULL COMMENT 'JSON: [{denom, qty, remark}]',
  `saved_by` INT UNSIGNED NULL,
  `saved_by_name` VARCHAR(100) NOT NULL DEFAULT '',
  `saved_by_role` VARCHAR(20) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `calc_version` TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT '1 = old formula, 2 = credit/debt aware',
  `debt_collected` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `debt_collected_online` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `outstanding_debts` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `debt_payments` TEXT NULL COMMENT 'JSON: debt repayments received on the audit date',
  `user_remark` TEXT NULL,
  `total_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `bank_deposit` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `remaining_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `bank_deposit_remark` TEXT NULL,
  `change_held` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `change_collected` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `outstanding_change` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `change_details` TEXT NULL COMMENT 'JSON: customer change left / collected on the audit date',
  PRIMARY KEY (`id`),
  KEY `idx_ca_date` (`audit_date`),
  KEY `idx_ca_saved_by` (`saved_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: cash_floats
-- Opening cash and float changes (add / reduce) per day.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cash_floats` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `float_date` DATE NOT NULL,
  `entry_type` ENUM('opening','add','reduce') NOT NULL,
  `amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `note` VARCHAR(255) NOT NULL DEFAULT '',
  `saved_by` INT UNSIGNED NULL,
  `saved_by_name` VARCHAR(100) NOT NULL DEFAULT '',
  `saved_by_role` VARCHAR(20) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_cf_date` (`float_date`),
  KEY `idx_cf_saved_by` (`saved_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: bank_deposits
-- Every bank deposit, with who/when, total cash, amount, remaining
-- cash, remark and the optional receipt photo.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS `bank_deposits` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `deposit_date` DATE NOT NULL,
  `audit_id` INT UNSIGNED NULL COMMENT 'latest cash audit of that date (kept in step automatically)',
  `total_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'cash counted before banking',
  `amount` DECIMAL(14,2) NOT NULL DEFAULT 0.00,
  `remaining_cash` DECIMAL(14,2) NOT NULL DEFAULT 0.00 COMMENT 'total cash minus all deposits made that day up to and including this one',
  `remark` TEXT NULL,
  `saved_by` INT UNSIGNED NULL,
  `saved_by_name` VARCHAR(100) NOT NULL DEFAULT '',
  `saved_by_role` VARCHAR(20) NOT NULL DEFAULT '',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `receipt_file` VARCHAR(255) NULL COMMENT 'stored file name of the bank receipt photo',
  `receipt_mime` VARCHAR(50) NULL,
  PRIMARY KEY (`id`),
  KEY `idx_bd_date` (`deposit_date`),
  KEY `idx_bd_saved_by` (`saved_by`),
  KEY `idx_bd_audit` (`audit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

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

-- Starter product categories (editable from the Products page)
INSERT IGNORE INTO `categories` (`name`) VALUES
  ('Rice'), ('Flour'), ('Cooking Oil'), ('Beans & Pulses'), ('Maize'), ('Sugar & Salt'), ('Other');

SET FOREIGN_KEY_CHECKS = 1;
