-- =====================================================================
-- GOLDEN GRAINS - SAMPLE DATA for Store Management and Costing
-- =====================================================================
-- HOW TO USE
--   1. Open the system once and visit "Store Management" (this creates the new tables).
--   2. phpMyAdmin -> select your GOLDEN GRAINS database -> Import -> choose this file.
--   3. Open Store Management. Dates are relative to today, so the filters
--      (Today, This week, This month ...) always show data.
--
-- WHAT IT CREATES (all clearly marked "(Sample)" or "[Sample]")
--   Products   : Rice (Sample)   -> types "Paddy (Mpunga)" and "Milled Rice (Mchele)"
--                Maize (Sample)  -> type  "Whole Grain"
--                Beans (Sample)  -> type  "Red"
--   Story      : 2 farm purchases with shared expenses, 2 milling transfers (paddy -> rice,
--                with processing cost and loss), 2 plain transfers, 1 pending, 1 approved,
--                1 cancelled transfer, damages in the store and at the shop, 2 adjustments.
--   Stock      : Main Store and POS/Shop quantities + actual costs are set to match the story.
--   Products page: the sample types get prices and POS stock, so they show there too.
--
-- You can run this file again at any time: it first removes its own earlier sample rows.
-- It needs at least one active admin user. Your real products are not touched.
-- To remove everything again, see the commented block at the very end.
-- =====================================================================

SET @admin  = (SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY id LIMIT 1);
SET @worker = COALESCE((SELECT id FROM users WHERE role = 'worker' AND status = 'active' ORDER BY id LIMIT 1), @admin);

-- ---------------------------------------------------------------------
-- 1. Remove sample records of an earlier run (keeps the products)
-- ---------------------------------------------------------------------
DELETE FROM farm_purchases   WHERE reference_no LIKE 'SAMPLE-%';
DELETE FROM stock_transfers  WHERE note LIKE '[Sample]%';
DELETE FROM stock_adjustments WHERE reason LIKE '[Sample]%';
DELETE FROM damages          WHERE notes LIKE '[Sample]%';

-- ---------------------------------------------------------------------
-- 2. Sample products and types (shown on the Products page)
-- ---------------------------------------------------------------------
INSERT IGNORE INTO categories (name) VALUES ('Rice'), ('Maize'), ('Beans & Pulses');

INSERT INTO products (name, category_id, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by)
SELECT 'Rice (Sample)', (SELECT id FROM categories WHERE name = 'Rice'), 'kg', 0, 0, NULL, 0, 5, 'active', @admin
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Rice (Sample)');
INSERT INTO products (name, category_id, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by)
SELECT 'Maize (Sample)', (SELECT id FROM categories WHERE name = 'Maize'), 'kg', 0, 0, NULL, 0, 5, 'active', @admin
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Maize (Sample)');
INSERT INTO products (name, category_id, unit, buying_price, selling_price, minimum_price, stock_quantity, reorder_level, status, created_by)
SELECT 'Beans (Sample)', (SELECT id FROM categories WHERE name = 'Beans & Pulses'), 'kg', 0, 0, NULL, 0, 5, 'active', @admin
  FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = 'Beans (Sample)');

SET @rice  = (SELECT id FROM products WHERE name = 'Rice (Sample)'  ORDER BY id LIMIT 1);
SET @maize = (SELECT id FROM products WHERE name = 'Maize (Sample)' ORDER BY id LIMIT 1);
SET @beans = (SELECT id FROM products WHERE name = 'Beans (Sample)' ORDER BY id LIMIT 1);

INSERT INTO product_variants (product_id, variant_name, unit, buying_price, selling_price, stock_quantity, reorder_level, status, created_by)
SELECT @rice, 'Paddy (Mpunga)', 'kg', 0, 0, 0, 50, 'active', @admin FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = @rice AND variant_name = 'Paddy (Mpunga)');
INSERT INTO product_variants (product_id, variant_name, unit, buying_price, selling_price, stock_quantity, reorder_level, status, created_by)
SELECT @rice, 'Milled Rice (Mchele)', 'kg', 0, 0, 0, 200, 'active', @admin FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = @rice AND variant_name = 'Milled Rice (Mchele)');
INSERT INTO product_variants (product_id, variant_name, unit, buying_price, selling_price, stock_quantity, reorder_level, status, created_by)
SELECT @maize, 'Whole Grain', 'kg', 0, 0, 0, 100, 'active', @admin FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = @maize AND variant_name = 'Whole Grain');
INSERT INTO product_variants (product_id, variant_name, unit, buying_price, selling_price, stock_quantity, reorder_level, status, created_by)
SELECT @beans, 'Red', 'kg', 0, 0, 0, 50, 'active', @admin FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM product_variants WHERE product_id = @beans AND variant_name = 'Red');

SET @v_paddy = (SELECT id FROM product_variants WHERE product_id = @rice  AND variant_name = 'Paddy (Mpunga)');
SET @v_rice  = (SELECT id FROM product_variants WHERE product_id = @rice  AND variant_name = 'Milled Rice (Mchele)');
SET @v_maize = (SELECT id FROM product_variants WHERE product_id = @maize AND variant_name = 'Whole Grain');
SET @v_beans = (SELECT id FROM product_variants WHERE product_id = @beans AND variant_name = 'Red');

-- Prices and POS/Shop stock (the stock the Sales page uses) at the end of the story below
UPDATE product_variants SET status = 'active', buying_price = 1300, selling_price = 1500, minimum_price = NULL, stock_quantity = 0,    reorder_level = 50  WHERE id = @v_paddy;
UPDATE product_variants SET status = 'active', buying_price = 2118, selling_price = 2800, minimum_price = 2600, stock_quantity = 3235, reorder_level = 200 WHERE id = @v_rice;
UPDATE product_variants SET status = 'active', buying_price = 744,  selling_price = 1100, minimum_price = 1000, stock_quantity = 1200, reorder_level = 100 WHERE id = @v_maize;
UPDATE product_variants SET status = 'active', buying_price = 2551, selling_price = 3400, minimum_price = 3200, stock_quantity = 398,  reorder_level = 50  WHERE id = @v_beans;

-- Start the Main Store and the cost records of these products from zero
DELETE FROM store_stock WHERE product_id IN (@rice, @maize, @beans);
DELETE FROM stock_costs WHERE product_id IN (@rice, @maize, @beans);

-- ---------------------------------------------------------------------
-- 3. FARM PURCHASE 1 (12 days ago): three products, shared expenses recorded once
--    Shared expenses are spread by purchase value.
-- ---------------------------------------------------------------------
INSERT INTO farm_purchases (farm_name, reference_no, note, allocation_method, purchase_total, admin_total, transport_total, landed_total, status, received_by, received_at)
VALUES ('Kyela Rice Farm', 'SAMPLE-DN-1001', '[Sample] First delivery: paddy, maize and beans', 'value', 10500000.00, 210000.00, 450000.00, 11160000.00, 'active', @admin,
        TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 12 DAY), '08:30:00'));
SET @p1 = LAST_INSERT_ID();

INSERT INTO farm_purchase_items (purchase_id, product_id, variant_id, quantity, unit_price, purchase_total, alloc_admin, alloc_transport, landed_total, landed_unit_cost) VALUES
  (@p1, @rice,  @v_paddy, 5000, 1200, 6000000.00, 120000.00, 257142.86, 6377142.86, 1275.4286),
  (@p1, @maize, @v_maize, 3000,  700, 2100000.00,  42000.00,  90000.00, 2232000.00,  744.0000),
  (@p1, @beans, @v_beans, 1000, 2400, 2400000.00,  48000.00, 102857.14, 2550857.14, 2550.8571);

INSERT INTO farm_purchase_expenses (purchase_id, category, description, amount) VALUES
  (@p1, 'transport', 'Truck hire, Kyela to Mbeya',        450000.00),
  (@p1, 'tax',       'Produce cess / levy',               105000.00),
  (@p1, 'storage',   'Warehouse keeping fee',              45000.00),
  (@p1, 'loading',   'Loading and offloading labour',      60000.00);

-- ---------------------------------------------------------------------
-- 4. TRANSFER 1 (10 days ago): MILLING. 3,000 kg paddy -> 1,950 kg rice (1,050 kg lost in milling)
--    Cost = paddy used 3,826,285.80 + processing 250,000 = 4,076,285.80  ->  2,090.40 per kg of rice
-- ---------------------------------------------------------------------
INSERT INTO stock_transfers (product_id, variant_id, quantity, source, destination, status, note, created_by, created_at,
                             completed_by, completed_at, output_product_id, output_variant_id, output_quantity, processing_cost,
                             unit_cost, input_cost, total_cost, output_unit_cost)
VALUES (@rice, @v_paddy, 3000, 'store', 'pos', 'completed', '[Sample] Milled at the local mill, first batch', @admin,
        TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 10 DAY), '09:00:00'),
        @admin, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 10 DAY), '09:20:00'),
        @rice, @v_rice, 1950, 250000.00, 1275.4286, 3826285.80, 4076285.80, 2090.4030);
SET @t1 = LAST_INSERT_ID();
INSERT INTO stock_transfer_costs (transfer_id, activity, amount) VALUES
  (@t1, 'Milling (kukoboa)',            180000.00),
  (@t1, 'Packaging (sacks and labels)',  40000.00),
  (@t1, 'Transport to the mill',         30000.00);

-- ---------------------------------------------------------------------
-- 5. FARM PURCHASE 2 (5 days ago): one product, a different price, so the cost history shows a change
-- ---------------------------------------------------------------------
INSERT INTO farm_purchases (farm_name, reference_no, note, allocation_method, purchase_total, admin_total, transport_total, landed_total, status, received_by, received_at)
VALUES ('Mbeya Farmers Co-operative', 'SAMPLE-DN-1002', '[Sample] Second paddy delivery', 'value', 2600000.00, 20000.00, 150000.00, 2770000.00, 'active', @admin,
        TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 5 DAY), '10:15:00'));
SET @p2 = LAST_INSERT_ID();
INSERT INTO farm_purchase_items (purchase_id, product_id, variant_id, quantity, unit_price, purchase_total, alloc_admin, alloc_transport, landed_total, landed_unit_cost) VALUES
  (@p2, @rice, @v_paddy, 2000, 1300, 2600000.00, 20000.00, 150000.00, 2770000.00, 1385.0000);
INSERT INTO farm_purchase_expenses (purchase_id, category, description, amount) VALUES
  (@p2, 'transport', 'Truck hire',               150000.00),
  (@p2, 'loading',   'Offloading labour',         20000.00);

-- ---------------------------------------------------------------------
-- 6. PLAIN TRANSFERS (4 days ago, recorded by a worker): the stock keeps its cost
-- ---------------------------------------------------------------------
INSERT INTO stock_transfers (product_id, variant_id, quantity, source, destination, status, note, created_by, created_at,
                             completed_by, completed_at, processing_cost, unit_cost, input_cost, total_cost, output_unit_cost) VALUES
  (@maize, @v_maize, 1200, 'store', 'pos', 'completed', '[Sample] Restocking the shelves', @worker,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '11:00:00'), @worker, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '11:05:00'),
   0, 744.0000, 892800.00, 892800.00, 744.0000),
  (@beans, @v_beans, 400, 'store', 'pos', 'completed', '[Sample] Restocking the shelves', @worker,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '11:10:00'), @worker, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 4 DAY), '11:15:00'),
   0, 2550.8571, 1020342.84, 1020342.84, 2550.8571);

-- ---------------------------------------------------------------------
-- 7. TRANSFER 4 (3 days ago): MILLING again, 2,000 kg paddy -> 1,300 kg rice
--    The paddy now costs 1,330.21 per kg (average of both purchases), so the rice costs more per kg.
-- ---------------------------------------------------------------------
INSERT INTO stock_transfers (product_id, variant_id, quantity, source, destination, status, note, created_by, created_at,
                             completed_by, completed_at, output_product_id, output_variant_id, output_quantity, processing_cost,
                             unit_cost, input_cost, total_cost, output_unit_cost)
VALUES (@rice, @v_paddy, 2000, 'store', 'pos', 'completed', '[Sample] Milled at the local mill, second batch', @admin,
        TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '14:00:00'),
        @admin, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '14:10:00'),
        @rice, @v_rice, 1300, 146000.00, 1330.2143, 2660428.60, 2806428.60, 2158.7912);
SET @t4 = LAST_INSERT_ID();
INSERT INTO stock_transfer_costs (transfer_id, activity, amount) VALUES
  (@t4, 'Milling (kukoboa)',            120000.00),
  (@t4, 'Packaging (sacks and labels)',  26000.00);

-- ---------------------------------------------------------------------
-- 8. TRANSFERS in other states (no stock moves until completed)
-- ---------------------------------------------------------------------
INSERT INTO stock_transfers (product_id, variant_id, quantity, source, destination, status, note, created_by, created_at,
                             approved_by, approved_at, cancelled_by, cancelled_at) VALUES
  (@beans, @v_beans,  50, 'store', 'pos', 'cancelled', '[Sample] Cancelled, counted wrongly', @worker,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '16:00:00'), NULL, NULL, @admin, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '16:30:00')),
  (@maize, @v_maize, 500, 'store', 'pos', 'pending',   '[Sample] Waiting for the admin', @worker,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '08:30:00'), NULL, NULL, NULL, NULL),
  (@beans, @v_beans, 100, 'store', 'pos', 'approved',  '[Sample] Approved, to be completed', @worker,
   TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '09:00:00'), @admin, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '09:30:00'), NULL, NULL);

-- ---------------------------------------------------------------------
-- 9. DAMAGES, by location
-- ---------------------------------------------------------------------
INSERT INTO damages (product_id, variant_id, item_type, item_name, quantity, reason, notes, location, loss_value, manual_cost, recorded_by, damage_date, created_at) VALUES
  (@maize, @v_maize, 'product', NULL, 25, 'Moisture and mould', '[Sample] Found at the back of the warehouse', 'store',  18600.00, NULL, @worker,
   DATE_SUB(CURDATE(), INTERVAL 3 DAY), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 3 DAY), '09:40:00')),
  (@rice,  @v_paddy, 'product', NULL, 40, 'Rodent damage',       '[Sample] Torn sacks in the main store',          'store',  52000.00, NULL, @admin,
   DATE_SUB(CURDATE(), INTERVAL 2 DAY), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '10:00:00')),
  (@rice,  @v_rice,  'product', NULL, 15, 'Spilled',             '[Sample] Bag split while packing at the shop',   'pos',    31770.00, NULL, @worker,
   DATE_SUB(CURDATE(), INTERVAL 2 DAY), TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '13:20:00'));

-- ---------------------------------------------------------------------
-- 10. ADJUSTMENTS
-- ---------------------------------------------------------------------
INSERT INTO stock_adjustments (product_id, variant_id, location, quantity_change, reason, note, adjusted_by, created_at) VALUES
  (@maize, @v_maize, 'store',  10.000, '[Sample] Stock count difference', 'Counted 10 kg more than the records', @admin, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 2 DAY), '15:00:00')),
  (@beans, @v_beans, 'pos',    -2.000, '[Sample] Stock count difference', 'Lost while repacking',                @admin, TIMESTAMP(DATE_SUB(CURDATE(), INTERVAL 1 DAY), '16:00:00'));

-- ---------------------------------------------------------------------
-- 11. CURRENT STOCK of the Main Store and the average ACTUAL COST per unit at each location
--     Main Store: paddy 5000-3000+2000-2000-40 = 1,960 | maize 3000-1200-25+10 = 1,785 | beans 1000-400 = 600
--     POS/Shop  : rice 1950+1300-15 = 3,235 | maize 1,200 | beans 400-2 = 398  (set on the products above)
-- ---------------------------------------------------------------------
INSERT INTO store_stock (product_id, variant_id, quantity) VALUES
  (@rice,  @v_paddy, 1960),
  (@maize, @v_maize, 1785),
  (@beans, @v_beans,  600)
ON DUPLICATE KEY UPDATE quantity = VALUES(quantity);

INSERT INTO stock_costs (location, product_id, variant_id, unit_cost) VALUES
  ('store', @rice,  @v_paddy, 1330.2143),
  ('store', @maize, @v_maize,  744.0000),
  ('store', @beans, @v_beans, 2550.8571),
  ('pos',   @rice,  @v_rice,  2117.7583),
  ('pos',   @maize, @v_maize,  744.0000),
  ('pos',   @beans, @v_beans, 2550.8571)
ON DUPLICATE KEY UPDATE unit_cost = VALUES(unit_cost);

-- =====================================================================
-- OPTIONAL: remove ALL the sample data (uncomment and run these lines)
-- =====================================================================
-- DELETE FROM farm_purchases    WHERE reference_no LIKE 'SAMPLE-%';
-- DELETE FROM stock_transfers   WHERE note LIKE '[Sample]%';
-- DELETE FROM stock_adjustments WHERE reason LIKE '[Sample]%';
-- DELETE FROM damages           WHERE notes LIKE '[Sample]%';
-- DELETE FROM products          WHERE name IN ('Rice (Sample)', 'Maize (Sample)', 'Beans (Sample)');
