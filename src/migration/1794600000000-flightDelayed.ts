import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlightDelayed1794600000000 implements MigrationInterface {
  name = 'FlightDelayed1794600000000';

  // The column is only added when missing, because dev synchronize adds it as
  // soon as the API reloads with the new entity, before this runs. Flights
  // already past their departure are marked by the delay job's next run.
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('flight', 'isDelayed'))) {
      await queryRunner.query(
        `ALTER TABLE "flight" ADD "isDelayed" boolean NOT NULL DEFAULT false`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "flight" DROP COLUMN "isDelayed"`);
  }
}
