import { MigrationInterface, QueryRunner } from 'typeorm';

export class DispatchPersistence1725790000000 implements MigrationInterface {
  name = 'DispatchPersistence1725790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TYPE "dispatches_status_enum" AS ENUM (
        'REQUESTED',
        'SEARCHING',
        'OFFERING',
        'ASSIGNED',
        'COMPLETED',
        'FAILED',
        'CANCELLED'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "dispatch_candidates_offer_status_enum" AS ENUM (
        'PENDING',
        'OFFERED',
        'ACCEPTED',
        'REJECTED',
        'TIMED_OUT',
        'CANCELLED'
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "dispatches" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "order_id" character varying NOT NULL,
        "restaurant_id" character varying NOT NULL,
        "status" "dispatches_status_enum" NOT NULL DEFAULT 'REQUESTED',
        "assigned_driver_id" character varying,
        "current_batch" integer NOT NULL DEFAULT 0,
        "attempt_count" integer NOT NULL DEFAULT 0,
        "failure_reason" character varying,
        "restaurant_to_customer_distance_meters" double precision,
        "restaurant_to_customer_duration_seconds" double precision,
        "assigned_at" TIMESTAMP,
        "completed_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_dispatches_order_id" UNIQUE ("order_id"),
        CONSTRAINT "PK_dispatches_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "dispatch_candidates" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "dispatch_id" uuid NOT NULL,
        "driver_id" character varying NOT NULL,
        "batch_number" integer NOT NULL,
        "redis_distance_meters" double precision NOT NULL,
        "osrm_distance_meters" double precision,
        "osrm_duration_seconds" double precision,
        "pre_eta_seconds" double precision,
        "ranking_score" double precision,
        "offer_status" "dispatch_candidates_offer_status_enum" NOT NULL DEFAULT 'PENDING',
        "offered_at" TIMESTAMP,
        "responded_at" TIMESTAMP,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_dispatch_candidates_dispatch_driver_batch" UNIQUE ("dispatch_id", "driver_id", "batch_number"),
        CONSTRAINT "PK_dispatch_candidates_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_dispatch_candidates_dispatch_id" FOREIGN KEY ("dispatch_id") REFERENCES "dispatches"("id") ON DELETE CASCADE ON UPDATE NO ACTION
      )
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_dispatch_candidates_dispatch_id" ON "dispatch_candidates" ("dispatch_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX "IDX_dispatch_candidates_dispatch_id"
    `);
    await queryRunner.query(`
      DROP TABLE "dispatch_candidates"
    `);
    await queryRunner.query(`
      DROP TABLE "dispatches"
    `);
    await queryRunner.query(`
      DROP TYPE "dispatch_candidates_offer_status_enum"
    `);
    await queryRunner.query(`
      DROP TYPE "dispatches_status_enum"
    `);
  }
}
