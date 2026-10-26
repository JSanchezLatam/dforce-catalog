CREATE TYPE "public"."espera_motivo" AS ENUM('repuesto', 'aprobacion_cliente');--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'booked' BEFORE 'open';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'diagnosing' BEFORE 'in_progress';--> statement-breakpoint
ALTER TYPE "public"."order_status" ADD VALUE 'on_hold' BEFORE 'ready_for_review';--> statement-breakpoint
CREATE TABLE "orden_estado_historial" (
	"id" text PRIMARY KEY NOT NULL,
	"orden_id" text NOT NULL,
	"from_status" "order_status",
	"to_status" "order_status" NOT NULL,
	"espera_motivo" "espera_motivo",
	"changed_by" text,
	"changed_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD COLUMN "espera_motivo" "espera_motivo";--> statement-breakpoint
ALTER TABLE "orden_estado_historial" ADD CONSTRAINT "orden_estado_historial_orden_id_orden_servicio_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."orden_servicio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_estado_historial" ADD CONSTRAINT "orden_estado_historial_changed_by_users_id_fk" FOREIGN KEY ("changed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orden_estado_historial_orden_changed_idx" ON "orden_estado_historial" USING btree ("orden_id","changed_at");--> statement-breakpoint
-- "status"::text, not a literal enum comparison: the three values above were added in this same transaction
-- (migrate() runs every pending file in one) and Postgres refuses to use them until it commits.
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_espera_motivo_on_hold" CHECK (("orden_servicio"."espera_motivo" IS NOT NULL) = ("orden_servicio"."status"::text = 'on_hold'));