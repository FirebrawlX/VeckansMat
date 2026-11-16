ALTER TABLE shopping_list_items ADD COLUMN is_offer INTEGER NOT NULL DEFAULT 0 CHECK (is_offer IN (0, 1));
