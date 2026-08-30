DROP INDEX "cliente_plate_idx";--> statement-breakpoint
ALTER TABLE "cliente" DROP COLUMN "vehicle_make";--> statement-breakpoint
ALTER TABLE "cliente" DROP COLUMN "vehicle_model";--> statement-breakpoint
ALTER TABLE "cliente" DROP COLUMN "vehicle_year";--> statement-breakpoint
ALTER TABLE "cliente" DROP COLUMN "vehicle_plate";