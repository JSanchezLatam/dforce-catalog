CREATE TABLE "vehiculo" (
	"id" text PRIMARY KEY NOT NULL,
	"cliente_id" text NOT NULL,
	"make" text,
	"model" text,
	"year" integer,
	"plate" text NOT NULL,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vehiculo" ADD CONSTRAINT "vehiculo_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "vehiculo_cliente_idx" ON "vehiculo" USING btree ("cliente_id");
--> statement-breakpoint
-- Pre-flight guard. `vehiculo.plate` is NOT NULL, so a `cliente` carrying
-- make/model/year with no plate cannot be represented in the new model. R17
-- forbids that row, but only in application validation — it is still reachable
-- by direct SQL or a bulk import. Fail loudly here rather than letting the
-- backfill's WHERE drop it silently.
DO $$
DECLARE
  unplated_count integer;
BEGIN
  SELECT count(*) INTO unplated_count
  FROM "cliente"
  WHERE "vehicle_plate" IS NULL
    AND ("vehicle_make" IS NOT NULL OR "vehicle_model" IS NOT NULL OR "vehicle_year" IS NOT NULL);

  IF unplated_count > 0 THEN
    RAISE EXCEPTION 'Migration 0013 aborted: % cliente row(s) carry vehicle make/model/year with no vehicle_plate. vehiculo.plate is NOT NULL, so those vehicles cannot be migrated. Set a plate on those rows, or clear their vehicle fields, then re-run.', unplated_count;
  END IF;
END $$;--> statement-breakpoint
-- Backfill (expand step, design.md D2): one `vehiculo` row for every `cliente`
-- row that had a plate, active (deactivated_at NULL). The guard above proves
-- this WHERE drops no vehicle-bearing row.
-- `gen_random_uuid()` needs no extra extension on PG 13+ (built-in).
INSERT INTO "vehiculo" ("id", "cliente_id", "make", "model", "year", "plate")
SELECT gen_random_uuid(), "id", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_plate"
FROM "cliente"
WHERE "vehicle_plate" IS NOT NULL;
