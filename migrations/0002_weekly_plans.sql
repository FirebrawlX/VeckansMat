CREATE TABLE IF NOT EXISTS weekly_plans (
  week_start TEXT PRIMARY KEY NOT NULL,
  updated_at INTEGER NOT NULL,
  shopping_list_id TEXT
);

CREATE TABLE IF NOT EXISTS weekly_plan_meals (
  week_start TEXT NOT NULL REFERENCES weekly_plans(week_start) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  recipe_id TEXT,
  PRIMARY KEY (week_start, day_of_week)
);

CREATE INDEX IF NOT EXISTS weekly_plan_meals_recipe ON weekly_plan_meals(recipe_id);
