ALTER TABLE recipe_ingredients ADD COLUMN section_code TEXT NOT NULL DEFAULT '';
ALTER TABLE shopping_list_items ADD COLUMN section_code TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS store_sections (
  code TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL
);

INSERT INTO store_sections (code, name, position) VALUES ('A', 'Frukt & grönt', 0);
