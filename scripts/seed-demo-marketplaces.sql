-- Repeatable demo marketplace seed: 10 sellers × 3 markets, 5 dishes per seller.
-- Run with:
--   psql "$JDBC_DATABASE_URL" -f scripts/seed-demo-marketplaces.sql

BEGIN;

WITH markets AS (
  SELECT * FROM (VALUES
    ('columbus', 'Columbus, OH', 39.9612::double precision, -82.9988::double precision),
    ('cyprus_odtu', 'ODTÜ Kuzey Kıbrıs, Güzelyurt', 35.2120::double precision, 32.9940::double precision),
    ('adana', 'Adana, Türkiye', 37.0000::double precision, 35.3213::double precision)
  ) AS m(slug, label, lat, lng)
), sellers AS (
  SELECT m.*, n,
    format('demo-%s-seller-%s', m.slug, n) AS seller_id,
    format('demo-%s-kitchen-%s', m.slug, n) AS kitchen_id,
    format('demo-%s-menu-today-%s', m.slug, n) AS menu_id,
    format('demo.%s.%s@nanas.local', m.slug, n) AS email,
    (ARRAY['turkish','lebanese','greek','italian','mexican','indian','persian','ethiopian','thai','vietnamese'])[n] AS cuisine,
    (ARRAY['Nana Zeynep''s Table','Mariam''s Levant Kitchen','Yia Yia''s Home Plate','Lucia''s Sunday Pasta','Rosa''s Family Cocina','Asha''s Spice Pot','Parisa''s Saffron Kitchen','Mekdes''s Injera House','Mali''s Thai Garden','Linh''s Saigon Kitchen'])[n] AS kitchen_name
  FROM markets m CROSS JOIN generate_series(1, 10) AS n
), credentials AS (
  SELECT "passwordHash" AS password_hash FROM "User" WHERE role = 'seller' LIMIT 1
), sample_address AS (
  SELECT "addressEncrypted" AS address_encrypted FROM "Kitchen" LIMIT 1
)
INSERT INTO "User" (id, role, email, "passwordHash", locale)
SELECT seller_id, 'seller'::"Role", email, credentials.password_hash, 'en'
FROM sellers CROSS JOIN credentials
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, "passwordHash" = EXCLUDED."passwordHash";

WITH markets AS (
  SELECT * FROM (VALUES
    ('columbus', 'Columbus, OH', 39.9612::double precision, -82.9988::double precision),
    ('cyprus_odtu', 'ODTÜ Kuzey Kıbrıs, Güzelyurt', 35.2120::double precision, 32.9940::double precision),
    ('adana', 'Adana, Türkiye', 37.0000::double precision, 35.3213::double precision)
  ) AS m(slug, label, lat, lng)
), sellers AS (
  SELECT m.*, n,
    format('demo-%s-seller-%s', m.slug, n) AS seller_id,
    format('demo-%s-kitchen-%s', m.slug, n) AS kitchen_id,
    (ARRAY['turkish','lebanese','greek','italian','mexican','indian','persian','ethiopian','thai','vietnamese'])[n] AS cuisine,
    (ARRAY['Nana Zeynep''s Table','Mariam''s Levant Kitchen','Yia Yia''s Home Plate','Lucia''s Sunday Pasta','Rosa''s Family Cocina','Asha''s Spice Pot','Parisa''s Saffron Kitchen','Mekdes''s Injera House','Mali''s Thai Garden','Linh''s Saigon Kitchen'])[n] AS kitchen_name
  FROM markets m CROSS JOIN generate_series(1, 10) AS n
), sample_address AS (
  SELECT "addressEncrypted" AS address_encrypted FROM "Kitchen" LIMIT 1
)
INSERT INTO "Kitchen" (id, "sellerId", name, "cuisineTag", description, photos, "addressEncrypted", "complianceAttestedAt", "ratingAvg", "ratingCount", "hygieneScoreTotal", "hygieneScoredAt", geo)
SELECT kitchen_id, seller_id, kitchen_name || ' — ' || label, cuisine,
  'Demo home kitchen serving freshly prepared cultural food.', '{}'::text[],
  sample_address.address_encrypted, now(), 4.6, 12 + n, 92 + (n % 7), now(),
  ST_SetSRID(ST_MakePoint(lng + ((n - 5) * 0.006), lat + ((n - 5) * 0.004)), 4326)::geography
FROM sellers CROSS JOIN sample_address
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name, "cuisineTag" = EXCLUDED."cuisineTag", description = EXCLUDED.description,
  "complianceAttestedAt" = EXCLUDED."complianceAttestedAt", geo = EXCLUDED.geo,
  "ratingAvg" = EXCLUDED."ratingAvg", "ratingCount" = EXCLUDED."ratingCount",
  "hygieneScoreTotal" = EXCLUDED."hygieneScoreTotal", "hygieneScoredAt" = EXCLUDED."hygieneScoredAt";

WITH markets AS (
  SELECT * FROM (VALUES
    ('columbus', 'Columbus, OH'), ('cyprus_odtu', 'ODTÜ Kuzey Kıbrıs, Güzelyurt'), ('adana', 'Adana, Türkiye')
  ) AS m(slug, label)
), sellers AS (
  SELECT m.*, n, format('demo-%s-kitchen-%s', m.slug, n) AS kitchen_id,
    format('demo-%s-menu-today-%s', m.slug, n) AS menu_id
  FROM markets m CROSS JOIN generate_series(1, 10) AS n
)
INSERT INTO "MenuDay" (id, "kitchenId", date, status, "readyWindows")
SELECT menu_id, kitchen_id, CURRENT_DATE, 'published'::"MenuDayStatus",
  '[{"start":"11:30","end":"20:30","slotMinutes":30}]'::jsonb
FROM sellers
ON CONFLICT (id) DO UPDATE SET date = EXCLUDED.date, status = EXCLUDED.status, "readyWindows" = EXCLUDED."readyWindows";

WITH markets AS (
  SELECT * FROM (VALUES ('columbus'), ('cyprus_odtu'), ('adana')) AS m(slug)
), sellers AS (
  SELECT m.slug, n, format('demo-%s-kitchen-%s', m.slug, n) AS kitchen_id,
    format('demo-%s-menu-today-%s', m.slug, n) AS menu_id
  FROM markets m CROSS JOIN generate_series(1, 10) AS n
), dishes AS (
  SELECT * FROM (VALUES
    (1, 'Signature Mezze Plate', 'A colorful plate of house-made small bites.', 1299, 480, ARRAY['vegetarian']::text[]),
    (2, 'Handmade Main Plate', 'Today''s hearty home-cooked specialty.', 1599, 720, ARRAY[]::text[]),
    (3, 'Seasonal Rice Bowl', 'Fragrant rice, vegetables and savory spices.', 1399, 610, ARRAY['gluten-free']::text[]),
    (4, 'Fresh Flatbread', 'Warm hand-rolled flatbread with a daily filling.', 899, 390, ARRAY['vegetarian']::text[]),
    (5, 'Baklava & Tea', 'A sweet finish served with aromatic tea.', 699, 340, ARRAY['vegetarian']::text[])
  ) AS d(position, name, description, price_cents, calories, tags)
)
INSERT INTO "Dish" (id, "kitchenId", name, description, photo, "priceCents", calories, "dietaryTags")
SELECT format('demo-%s-dish-%s-%s', s.slug, s.n, d.position), s.kitchen_id,
  d.name, d.description, NULL, d.price_cents, d.calories, d.tags
FROM sellers s CROSS JOIN dishes d
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description,
  "priceCents" = EXCLUDED."priceCents", calories = EXCLUDED.calories, "dietaryTags" = EXCLUDED."dietaryTags";

WITH markets AS (
  SELECT * FROM (VALUES ('columbus'), ('cyprus_odtu'), ('adana')) AS m(slug)
), sellers AS (
  SELECT m.slug, n, format('demo-%s-menu-today-%s', m.slug, n) AS menu_id
  FROM markets m CROSS JOIN generate_series(1, 10) AS n
), dishes AS (SELECT generate_series(1, 5) AS position)
INSERT INTO "MenuItem" (id, "menuDayId", "dishId", "portionsTotal", "portionsRemaining")
SELECT format('demo-%s-menu-item-%s-%s', s.slug, s.n, d.position), s.menu_id,
  format('demo-%s-dish-%s-%s', s.slug, s.n, d.position), 18 + d.position, 18 + d.position
FROM sellers s CROSS JOIN dishes d
ON CONFLICT (id) DO UPDATE SET "portionsTotal" = EXCLUDED."portionsTotal", "portionsRemaining" = EXCLUDED."portionsRemaining";

COMMIT;
