-- Acme Shop's sample data, used by the Database Internals & Performance pages (PostgreSQL 18).
-- Deterministic: setseed() fixes random(), and parallel query is off while seeding.
-- See README.md next to this file for how to load it (about a minute).
SET max_parallel_workers_per_gather = 0;
SELECT setseed(0.42);

CREATE TABLE customers (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  email       text NOT NULL UNIQUE,
  name        text NOT NULL,
  country     char(2) NOT NULL,
  created_at  timestamptz NOT NULL
);
INSERT INTO customers (email, name, country, created_at)
SELECT 'customer' || g || '@example.com',
       'Customer ' || g,
       CASE WHEN r < 0.55 THEN 'TH' WHEN r < 0.70 THEN 'SG' WHEN r < 0.82 THEN 'MY'
            WHEN r < 0.90 THEN 'VN' WHEN r < 0.96 THEN 'ID' ELSE 'PH' END,
       timestamptz '2024-01-01 00:00+07' + (g / 100000.0) * interval '640 days'
FROM (SELECT g, random() AS r FROM generate_series(1, 100000) g) s;

CREATE TABLE products (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         text NOT NULL UNIQUE,
  name        text NOT NULL,
  category    text NOT NULL,
  price_thb   numeric(10,2) NOT NULL
);
INSERT INTO products (sku, name, category, price_thb)
SELECT 'SKU-' || lpad(g::text, 6, '0'),
       'Product ' || g,
       (ARRAY['shoes','bags','phones','laptops','kitchen','toys','books','beauty','sports','garden','pets','grocery'])[1 + (g % 12)],
       round((59 + random() * 9940)::numeric, 2)
FROM generate_series(1, 10000) g;

CREATE TABLE orders (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  customer_id      bigint NOT NULL REFERENCES customers (id),
  status           text NOT NULL,
  shipping_country char(2) NOT NULL,
  created_at       timestamptz NOT NULL,
  total_thb        numeric(12,2) NOT NULL DEFAULT 0
);
-- A few customers order a lot (power-law ids); orders arrive in time order, so created_at follows id.
INSERT INTO orders (customer_id, status, shipping_country, created_at)
SELECT 1 + floor(100000 * power(random(), 2.2))::bigint,
       CASE WHEN g > 497000 THEN (ARRAY['pending','paid','shipped'])[1 + floor(random() * 3)::int]
            WHEN r < 0.02 THEN 'cancelled' ELSE 'delivered' END,
       'TH',
       timestamptz '2025-01-01 00:00+07' + (g / 500000.0) * interval '640 days' + random() * interval '20 minutes'
FROM (SELECT g, random() AS r FROM generate_series(1, 500000) g) s;
UPDATE orders o SET shipping_country = c.country FROM customers c WHERE c.id = o.customer_id;

CREATE TABLE order_items (
  order_id    bigint NOT NULL REFERENCES orders (id),
  line_no     int NOT NULL,
  product_id  bigint NOT NULL REFERENCES products (id),
  qty         int NOT NULL,
  price_thb   numeric(10,2) NOT NULL,
  PRIMARY KEY (order_id, line_no)
);
INSERT INTO order_items (order_id, line_no, product_id, qty, price_thb)
SELECT o.id, l, 1 + floor(10000 * power(random(), 1.8))::bigint, 1 + floor(random() * 3)::int, 0
FROM orders o
CROSS JOIN LATERAL generate_series(1, 1 + (o.id % 4)::int) l;
UPDATE order_items i SET price_thb = p.price_thb FROM products p WHERE p.id = i.product_id;
UPDATE orders o SET total_thb = t.s
FROM (SELECT order_id, sum(qty * price_thb) s FROM order_items GROUP BY order_id) t WHERE t.order_id = o.id;

CREATE TABLE order_events (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders (id),
  kind        text NOT NULL,
  happened_at timestamptz NOT NULL
);
INSERT INTO order_events (order_id, kind, happened_at)
SELECT o.id, e.kind, o.created_at + e.delay
FROM orders o
CROSS JOIN LATERAL (VALUES ('placed', interval '0'), ('paid', interval '3 minutes'), ('shipped', interval '1 day')) e(kind, delay)
ORDER BY o.created_at + e.delay;

VACUUM ANALYZE;
SELECT 'customers' t, count(*) FROM customers UNION ALL SELECT 'products', count(*) FROM products
UNION ALL SELECT 'orders', count(*) FROM orders UNION ALL SELECT 'order_items', count(*) FROM order_items
UNION ALL SELECT 'order_events', count(*) FROM order_events;

-- The template used for the pages was compacted once more after seeding:
VACUUM (FULL, ANALYZE);
