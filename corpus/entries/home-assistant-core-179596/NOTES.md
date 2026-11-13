# home-assistant/core#179596

Adds an order_by on the primary key to two helper queries in recorder statistics tests so PostgreSQL returns rows in a stable order. Honest flaky fix that keeps every assertion.
