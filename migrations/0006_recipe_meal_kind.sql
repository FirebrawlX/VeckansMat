ALTER TABLE recipes ADD COLUMN meal_kind TEXT NOT NULL DEFAULT 'dinner'
  CHECK (meal_kind IN ('dinner', 'lunch'));

UPDATE weekly_plan_meals
SET meal_type = COALESCE((SELECT meal_kind FROM recipes WHERE recipes.id = weekly_plan_meals.recipe_id), 'dinner');
