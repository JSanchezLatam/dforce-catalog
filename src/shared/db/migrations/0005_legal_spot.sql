CREATE TYPE "public"."order_status" AS ENUM('open', 'in_progress', 'done', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."reminder_channel" AS ENUM('email', 'whatsapp');--> statement-breakpoint
CREATE TYPE "public"."reminder_status" AS ENUM('scheduled', 'sent', 'failed', 'cancelled', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."reminder_type" AS ENUM('service_due', 'appointment');--> statement-breakpoint
CREATE TABLE "cliente" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_year" integer,
	"vehicle_plate" text,
	"whatsapp_opt_out" boolean DEFAULT false NOT NULL,
	"email_opt_out" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orden_servicio" (
	"id" text PRIMARY KEY NOT NULL,
	"cliente_id" text NOT NULL,
	"status" "order_status" DEFAULT 'open' NOT NULL,
	"description" text,
	"appointment_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orden_servicio_item" (
	"id" text PRIMARY KEY NOT NULL,
	"orden_id" text NOT NULL,
	"producto_id" text,
	"product_name" text NOT NULL,
	"unit_price" real,
	"quantity" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminder" (
	"id" text PRIMARY KEY NOT NULL,
	"orden_id" text NOT NULL,
	"cliente_id" text NOT NULL,
	"type" "reminder_type" NOT NULL,
	"channel" "reminder_channel" NOT NULL,
	"status" "reminder_status" DEFAULT 'scheduled' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone,
	"job_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_servicio_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_servicio" ADD CONSTRAINT "orden_servicio_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_servicio_item" ADD CONSTRAINT "orden_servicio_item_orden_id_orden_servicio_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."orden_servicio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orden_servicio_item" ADD CONSTRAINT "orden_servicio_item_producto_id_producto_id_fk" FOREIGN KEY ("producto_id") REFERENCES "public"."producto"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_orden_id_orden_servicio_id_fk" FOREIGN KEY ("orden_id") REFERENCES "public"."orden_servicio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminder" ADD CONSTRAINT "reminder_cliente_id_cliente_id_fk" FOREIGN KEY ("cliente_id") REFERENCES "public"."cliente"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cliente_name_idx" ON "cliente" USING btree ("name");--> statement-breakpoint
CREATE INDEX "cliente_plate_idx" ON "cliente" USING btree ("vehicle_plate");--> statement-breakpoint
CREATE INDEX "cliente_created_idx" ON "cliente" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orden_cliente_created_idx" ON "orden_servicio" USING btree ("cliente_id","created_at");--> statement-breakpoint
CREATE INDEX "orden_status_idx" ON "orden_servicio" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orden_item_orden_idx" ON "orden_servicio_item" USING btree ("orden_id");--> statement-breakpoint
CREATE INDEX "reminder_orden_idx" ON "reminder" USING btree ("orden_id");--> statement-breakpoint
CREATE INDEX "reminder_status_sched_idx" ON "reminder" USING btree ("status","scheduled_for");