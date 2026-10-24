ALTER TABLE required_parts DROP CONSTRAINT required_parts_quantity_check;
ALTER TABLE required_parts ALTER COLUMN quantity TYPE numeric(15,3) USING quantity::numeric;
ALTER TABLE required_parts ADD CONSTRAINT required_parts_quantity_check CHECK(quantity>0 AND quantity<=10000);
