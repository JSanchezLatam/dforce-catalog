CREATE TABLE "cliente_consentimiento" (
	"id" text PRIMARY KEY NOT NULL,
	"cliente_id" text NOT NULL,
	"granted" boolean NOT NULL,
	"clause_version" text NOT NULL,
	"recorded_by" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cliente_consentimiento" ADD CONSTRAINT "cliente_consentimiento_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cliente_consentimiento" ADD CONSTRAINT "cliente_consentimiento_recorded_by_users_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cliente_consentimiento_cliente_idx" ON "cliente_consentimiento" USING btree ("cliente_id","recorded_at" DESC NULLS LAST);