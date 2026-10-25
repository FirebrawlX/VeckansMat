ALTER TABLE recipes ADD COLUMN food_category TEXT NOT NULL DEFAULT 'other';

UPDATE recipes SET food_category = food_type;
