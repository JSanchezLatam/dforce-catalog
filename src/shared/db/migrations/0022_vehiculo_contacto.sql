CREATE TYPE "public"."vencimiento_kind" AS ENUM('placa', 'seguro');--> statement-breakpoint
CREATE TABLE "vehiculo_contacto" (
	"vehiculo_id" text NOT NULL,
	"kind" "vencimiento_kind" NOT NULL,
	"period_key" text NOT NULL,
	"contacted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"contacted_by" text,
	CONSTRAINT "vehiculo_contacto_vehiculo_id_kind_period_key_pk" PRIMARY KEY("vehiculo_id","kind","period_key")
);
--> statement-breakpoint
ALTER TABLE "vehiculo_contacto" ADD CONSTRAINT "vehiculo_contacto_vehiculo_id_vehiculo_id_fk" FOREIGN KEY ("vehiculo_id") REFERENCES "public"."vehiculo"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehiculo_contacto" ADD CONSTRAINT "vehiculo_contacto_contacted_by_users_id_fk" FOREIGN KEY ("contacted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;