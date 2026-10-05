CREATE TABLE "orden_servicio_foto" (
	"id" text PRIMARY KEY NOT NULL,
	"orden_id" text NOT NULL,
	"r2_key" text NOT NULL,
	"position" smallint NOT NULL,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orden_servicio_foto" ADD CONSTRAINT "orden_servicio_foto_orden_id_orden_servicio_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."orden_servicio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_servicio_foto" ADD CONSTRAINT "orden_servicio_foto_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orden_servicio_foto_orden_position_idx" ON "orden_servicio_foto" USING btree ("orden_id","position");