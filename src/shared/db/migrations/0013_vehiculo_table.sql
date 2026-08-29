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
CREATE INDEX "vehiculo_plate_idx" ON "vehiculo" USING btree ("plate");--> statement-breakpoint
-- Backfill (expand step, design.md D2): one `vehiculo` row for every `cliente`
-- row that had any inline vehicle field set, active (deactivated_at NULL).
-- `gen_random_uuid()` needs no extra extension on PG 13+ (built-in).
INSERT INTO "vehiculo" ("id", "cliente_id", "make", "model", "year", "plate")
SELECT gen_random_uuid(), "id", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_plate"
FROM "cliente"
WHERE "vehicle_plate" IS NOT NULL;