GOLDEN GRAINS - Business Management System
==========================================

Folders
  frontend/   HTML, CSS and JavaScript (the screens)
  backend/    PHP (API, login, installer)
  database/   golden_grains.sql  (complete MySQL schema)

Setup on XAMPP
  1. Copy this whole "golden-grains" folder to  C:\xampp\htdocs\
  2. Start Apache and MySQL in the XAMPP Control Panel.
  3. Open  http://localhost/golden-grains/backend/install.php
       - Database Host: localhost
         (if your MySQL runs on port 3307, type  localhost;port=3307 )
       - Database Name: golden_grains   (created automatically)
       - Database User / Password: root / (empty by default)
       - Create the first Admin account and a security question.
     The installer imports database/golden_grains.sql and writes backend/config.php.
  4. Open  http://localhost/golden-grains/frontend/index.html  and log in.

Alternative: import database/golden_grains.sql yourself in phpMyAdmin, then copy
backend/config.sample.php to backend/config.php and fill in your details.

To reinstall from scratch: delete backend/config.php and drop the golden_grains database.

Store Management (Farm -> Main Store -> POS/Shop)
  - Open "Store Management" in the menu. Stock received from the farm goes into the Main Store; transfers move it to the POS/Shop.
  - POS/Shop stock is the stock the Sales page uses. Main Store stock is kept separately.
  - Existing installations upgrade automatically the first time the Store or Damages page is opened
    (database/migrate_store_management.sql does the same by hand, if you prefer).

Notes
  - Internal management system only: staff log in; there is no customer ordering side.
  - Quantities are whole numbers (same as eDesk). Sell rice/flour by the kg, bag or sack as the unit.
  - Starter categories (Rice, Flour, Cooking Oil, Beans & Pulses, Maize, Sugar & Salt, Other) are added automatically.
