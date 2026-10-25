ALTER TABLE weekly_plan_meals ADD COLUMN eaten INTEGER NOT NULL DEFAULT 0
  CHECK (eaten IN (0, 1));
