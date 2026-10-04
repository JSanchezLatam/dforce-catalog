CREATE TYPE "public"."vehiculo_motor" AS ENUM('combustion', 'electrico', 'hibrido');--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "chasis" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "color_primario" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "color_secundario" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "estilo" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "motor" "vehiculo_motor";--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "numero_unidad" text;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "placa_renovacion_mes" smallint;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD COLUMN "seguro_vence" date;--> statement-breakpoint
ALTER TABLE "vehiculo" ADD CONSTRAINT "vehiculo_placa_renovacion_mes_range" CHECK ("vehiculo"."placa_renovacion_mes" between 1 and 12);