import { MigrationInterface, QueryRunner } from 'typeorm';

export class FlightEditing1794240000000 implements MigrationInterface {
  name = 'FlightEditing1794240000000';

  // Each column is only added when missing, because dev synchronize adds them
  // as soon as the API reloads with the new entities, before this runs
  public async up(queryRunner: QueryRunner): Promise<void> {
    if (!(await queryRunner.hasColumn('flight', 'version'))) {
      await queryRunner.query(
        `ALTER TABLE "flight" ADD "version" integer NOT NULL DEFAULT 1`,
      );
    }

    if (!(await queryRunner.hasColumn('order', 'flightSelections'))) {
      // Older orders have no per-flight seat counts to fill the new column
      // with, and the app holds no real orders, so they are removed instead
      await queryRunner.query(`DELETE FROM "flight_order"`);
      await queryRunner.query(`DELETE FROM "order"`);
      await queryRunner.query(
        `ALTER TABLE "order" ADD "flightSelections" json NOT NULL`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "order" DROP COLUMN "flightSelections"`,
    );
    await queryRunner.query(`ALTER TABLE "flight" DROP COLUMN "version"`);
  }
}
