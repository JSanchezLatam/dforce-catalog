CREATE TABLE "orden_servicio_correccion" (
	"id" text PRIMARY KEY NOT NULL,
	"orden_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text
);
--> statement-breakpoint
ALTER TABLE "orden_servicio_correccion" ADD CONSTRAINT "orden_servicio_correccion_orden_id_orden_servicio_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."orden_servicio"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_servicio_correccion" ADD CONSTRAINT "orden_servicio_correccion_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;