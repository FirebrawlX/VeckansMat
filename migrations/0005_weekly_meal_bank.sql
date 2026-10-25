ALTER TABLE weekly_plan_meals RENAME TO weekly_plan_meals_legacy;

CREATE TABLE weekly_plan_meals (
  week_start TEXT NOT NULL REFERENCES weekly_plans(week_start) ON DELETE CASCADE,
  position INTEGER NOT NULL CHECK (position BETWEEN 0 AND 20),
  recipe_id TEXT,
  meal_type TEXT NOT NULL DEFAULT 'dinner' CHECK (meal_type IN ('dinner', 'lunch')),
  PRIMARY KEY (week_start, position)
);

INSERT INTO weekly_plan_meals (week_start, position, recipe_id, meal_type)
SELECT week_start, day_of_week, recipe_id, 'dinner' FROM weekly_plan_meals_legacy;

DROP TABLE weekly_plan_meals_legacy;
CREATE INDEX IF NOT EXISTS weekly_plan_meals_recipe ON weekly_plan_meals(recipe_id);
