import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialMigration1790260456005 implements MigrationInterface {
    name = 'InitialMigration1790260456005'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."dispatch_candidates_offer_status_enum" AS ENUM('PENDING', 'OFFERED', 'ACCEPTED', 'REJECTED', 'TIMED_OUT')`);
        await queryRunner.query(`CREATE TABLE "dispatch_candidates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "dispatch_id" uuid NOT NULL, "driver_id" character varying NOT NULL, "batch_number" integer NOT NULL, "redis_distance_meters" double precision NOT NULL, "osrm_distance_meters" double precision, "osrm_duration_seconds" double precision, "pre_eta_seconds" double precision, "ranking_score" double precision, "offer_status" "public"."dispatch_candidates_offer_status_enum" NOT NULL DEFAULT 'PENDING', "offered_at" TIMESTAMP, "responded_at" TIMESTAMP, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_730f7ec5986f0b4f29f63bef6f2" UNIQUE ("dispatch_id", "driver_id", "batch_number"), CONSTRAINT "PK_f4a6b6d5821090a2d7886b45ce2" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "idx_dispatch_candidates_dispatch_id" ON "dispatch_candidates" ("dispatch_id") `);
        await queryRunner.query(`CREATE TYPE "public"."dispatches_status_enum" AS ENUM('REQUESTED', 'SEARCHING', 'OFFERING', 'ASSIGNED', 'COMPLETED', 'FAILED', 'CANCELLED')`);
        await queryRunner.query(`CREATE TABLE "dispatches" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "order_id" character varying NOT NULL, "restaurant_id" character varying NOT NULL, "restaurant_coords" jsonb NOT NULL, "customer_coords" jsonb NOT NULL, "status" "public"."dispatches_status_enum" NOT NULL DEFAULT 'REQUESTED', "assigned_driver_id" character varying, "current_batch" integer NOT NULL DEFAULT '0', "attempt_count" integer NOT NULL DEFAULT '0', "failure_reason" character varying, "restaurant_to_customer_eta_seconds" integer, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), "assigned_at" TIMESTAMP, "completed_at" TIMESTAMP, CONSTRAINT "UQ_c7d451fd4dff4c87b036973f4a9" UNIQUE ("order_id"), CONSTRAINT "PK_e4f5defc12b20b66acf58f5c8b9" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "dispatch_config" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "is_default" boolean NOT NULL DEFAULT false, "max_total_distance_meters" integer NOT NULL DEFAULT '15000', "max_total_eta_seconds" integer NOT NULL DEFAULT '3600', "ranking_weights" jsonb NOT NULL, "max_distance_km" double precision NOT NULL DEFAULT '10', "candidate_pool_size" integer NOT NULL DEFAULT '15', "batch_size" integer NOT NULL DEFAULT '5', "search_radii_km" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_e3612fb3937046a445c4e5b63f1" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "dispatch_candidates" ADD CONSTRAINT "FK_3d061db53bb0ab1ee2d5639167a" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "dispatch_candidates" DROP CONSTRAINT "FK_3d061db53bb0ab1ee2d5639167a"`);
        await queryRunner.query(`DROP TABLE "dispatch_config"`);
        await queryRunner.query(`DROP TABLE "dispatches"`);
        await queryRunner.query(`DROP TYPE "public"."dispatches_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."idx_dispatch_candidates_dispatch_id"`);
        await queryRunner.query(`DROP TABLE "dispatch_candidates"`);
        await queryRunner.query(`DROP TYPE "public"."dispatch_candidates_offer_status_enum"`);
    }

}
