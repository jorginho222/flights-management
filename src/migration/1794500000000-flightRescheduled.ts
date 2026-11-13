import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlightRescheduled1794500000000 implements MigrationInterface {
  name = 'FlightRescheduled1794500000000';

  // The column is only added when missing, because dev synchronize adds it as
  // soon as the API reloads with the new entity, before this runs
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('flight', 'wasRescheduled'))) {
      await queryRunner.query(
        `ALTER TABLE "flight" ADD "wasRescheduled" boolean NOT NULL DEFAULT false`,
      );
    }

    // onTime, advanced and delayed are no longer statuses. A schedule change
    // used to set advanced or delayed, which now becomes the flag instead.
    await queryRunner.query(
      `UPDATE "flight" SET "wasRescheduled" = true, "status" = 'scheduled' WHERE "status" IN ('advanced', 'delayed')`,
    );
    await queryRunner.query(
      `UPDATE "flight" SET "status" = 'scheduled' WHERE "status" = 'onTime'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "flight" DROP COLUMN "wasRescheduled"`,
    );
  }
}
