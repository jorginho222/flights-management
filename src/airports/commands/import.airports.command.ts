import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ormConfigOptions } from '../../../ormConfig';
import { Airport } from '../entities/airport.entity';
import { AirportsImportService } from '../airports.import.service';
import { OurAirportsClient } from '../ourairports.client';

// Only what the import needs, so the command doesn't boot mailer or S3
@Module({
  imports: [
    TypeOrmModule.forRoot({ ...ormConfigOptions, logging: false }),
    TypeOrmModule.forFeature([Airport]),
  ],
  providers: [OurAirportsClient, AirportsImportService],
})
class AirportsImportModule {}

// npm run airports:import
async function run(): Promise<void> {
  const logger = new Logger('AirportsImport');
  const app = await NestFactory.createApplicationContext(AirportsImportModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const result = await app.get(AirportsImportService).import();
    logger.log(
      `Fetched ${result.fetched} rows, upserted ${result.upserted} airports`,
    );
  } finally {
    await app.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
