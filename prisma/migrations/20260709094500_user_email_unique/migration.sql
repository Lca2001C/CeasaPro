DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (
      SELECT lower(trim("email")) AS normalized_email
      FROM "users"
      GROUP BY lower(trim("email"))
      HAVING count(*) > 1
    ) duplicates
  ) THEN
    RAISE EXCEPTION 'Cannot add unique users.email index: duplicate normalized emails exist';
  END IF;
END $$;

UPDATE "users"
SET "email" = lower(trim("email"));

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
