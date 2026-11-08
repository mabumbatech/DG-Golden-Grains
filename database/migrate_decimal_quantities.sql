-- Golden Grains: allow decimal quantities (e.g. 2.5 kg)
-- Run this ONCE on an EXISTING database (phpMyAdmin > golden_grains > SQL tab).
-- New installs already get these columns from golden_grains.sql.
-- Existing stock, sales, purchases and damages keep their values.

ALTER TABLE `products`
  MODIFY `stock_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  MODIFY `reorder_level`  DECIMAL(12,3) NOT NULL DEFAULT 5.000;

ALTER TABLE `product_variants`
  MODIFY `stock_quantity` DECIMAL(12,3) NOT NULL DEFAULT 0.000,
  MODIFY `reorder_level`  DECIMAL(12,3) NOT NULL DEFAULT 5.000;

ALTER TABLE `sale_items`
  MODIFY `quantity` DECIMAL(12,3) NOT NULL;

ALTER TABLE `purchases`
  MODIFY `quantity` DECIMAL(12,3) NOT NULL;

ALTER TABLE `damages`
  MODIFY `quantity` DECIMAL(12,3) NULL DEFAULT NULL;
