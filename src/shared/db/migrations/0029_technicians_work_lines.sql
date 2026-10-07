CREATE TABLE "orden_linea_trabajo" (
	"id" text PRIMARY KEY NOT NULL,
	"orden_id" text NOT NULL,
	"tecnico_id" text NOT NULL,
	"descripcion" text NOT NULL,
	"duracion_minutos" integer NOT NULL,
	"fecha" date NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orden_linea_duracion_range" CHECK ("orden_linea_trabajo"."duracion_minutos" > 0 and "orden_linea_trabajo"."duracion_minutos" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "orden_tecnico" (
	"orden_id" text NOT NULL,
	"tecnico_id" text NOT NULL,
	"parte_lista_at" timestamp with time zone,
	"assigned_by" text NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orden_tecnico_orden_id_tecnico_id_pk" PRIMARY KEY("orden_id","tecnico_id")
);
--> statement-breakpoint
CREATE TABLE "tecnico" (
	"id" text PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"user_id" text,
	"deactivated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tecnico_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
ALTER TABLE "orden_linea_trabajo" ADD CONSTRAINT "orden_linea_trabajo_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_linea_trabajo" ADD CONSTRAINT "orden_linea_trabajo_asignacion_fk" FOREIGN KEY ("orden_id","tecnico_id") REFERENCES "public"."orden_tecnico"("orden_id","tecnico_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_tecnico" ADD CONSTRAINT "orden_tecnico_orden_id_orden_servicio_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."orden_servicio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_tecnico" ADD CONSTRAINT "orden_tecnico_tecnico_id_tecnico_id_fk" FOREIGN KEY ("tecnico_id") REFERENCES "public"."tecnico"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_tecnico" ADD CONSTRAINT "orden_tecnico_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tecnico" ADD CONSTRAINT "tecnico_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "orden_linea_tecnico_fecha_idx" ON "orden_linea_trabajo" USING btree ("tecnico_id","fecha");--> statement-breakpoint
CREATE INDEX "orden_linea_orden_idx" ON "orden_linea_trabajo" USING btree ("orden_id");--> statement-breakpoint
CREATE INDEX "orden_tecnico_tecnico_idx" ON "orden_tecnico" USING btree ("tecnico_id");--> statement-breakpoint
-- Backfill: every existing login with role 'tecnico' becomes a linked roster row.
-- Only 'tecnico' (a pre-existing enum value) is referenced here: 0028 added the new
-- values in this same transaction and Postgres refuses to use them until it commits.
INSERT INTO "tecnico" ("id", "nombre", "user_id", "deactivated_at", "created_at") SELECT gen_random_uuid()::text, coalesce(nullif(btrim("name"), ''), "username"), "id", "deactivated_at", now() FROM "users" WHERE "role" = 'tecnico';
