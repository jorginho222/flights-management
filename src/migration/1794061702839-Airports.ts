import { MigrationInterface, QueryRunner } from 'typeorm';

export class Airports1794061702839 implements MigrationInterface {
  name = 'Airports1794061702839';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "airport" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "iataCode" character varying(3) NOT NULL, "icaoCode" character varying(4), "name" character varying NOT NULL, "city" character varying, "countryCode" character varying(2) NOT NULL, "countryName" character varying NOT NULL, "continent" character varying(2) NOT NULL, "latitude" double precision NOT NULL, "longitude" double precision NOT NULL, "elevationFt" integer, "type" character varying NOT NULL, CONSTRAINT "UQ_a15ad307dfbef63e6ae7e8c4fb4" UNIQUE ("iataCode"), CONSTRAINT "PK_ea1ecba8dec9bee0cb60194e788" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(`ALTER TABLE "flight" DROP COLUMN "origin"`);
    await queryRunner.query(`ALTER TABLE "flight" DROP COLUMN "destination"`);
    await queryRunner.query(
      `ALTER TABLE "flight" ADD "originId" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "flight" ADD "destinationId" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "flight" ADD CONSTRAINT "FK_7c41c43fa8adb11ef2ebbdc1294" FOREIGN KEY ("originId") REFERENCES "airport"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "flight" ADD CONSTRAINT "FK_52270caf4d404757d71e8ac950d" FOREIGN KEY ("destinationId") REFERENCES "airport"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "flight" DROP CONSTRAINT "FK_52270caf4d404757d71e8ac950d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "flight" DROP CONSTRAINT "FK_7c41c43fa8adb11ef2ebbdc1294"`,
    );
    await queryRunner.query(`ALTER TABLE "flight" DROP COLUMN "destinationId"`);
    await queryRunner.query(`ALTER TABLE "flight" DROP COLUMN "originId"`);
    await queryRunner.query(
      `ALTER TABLE "flight" ADD "destination" character varying NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "flight" ADD "origin" character varying NOT NULL`,
    );
    await queryRunner.query(`DROP TABLE "airport"`);
  }
}
