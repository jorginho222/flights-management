import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FlightsUpsertService } from './flights.upsert.service';
import { FlightsController } from './flights.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Flight } from './entities/flight.entity';
import { FlightsSearchService } from './flights.search.service';
import { FlightsReserveService } from './flights.reserve.service';
import { Passenger } from '../passengers/entities/passenger.entity';
import { AirplanesModule } from '../airplanes/airplanes.module';
import { Airline } from '../airlines/entities/airline.entity';
import { Airport } from '../airports/entities/airport.entity';
import { FlightsUpdateService } from './flights.update.service';
import { FlightUpdatesStream } from './subscribers/flight.updates.stream';
import { FlightsDelayService } from './flights.delay.service';
import { delayToleranceProvider } from './flight.delay.tolerance';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([Flight, Passenger, Airline, Airport]),
    AirplanesModule,
  ],
  controllers: [FlightsController],
  providers: [
    FlightsUpsertService,
    FlightsUpdateService,
    FlightsSearchService,
    FlightsReserveService,
    FlightUpdatesStream,
    FlightsDelayService,
    delayToleranceProvider,
  ],
})
export class FlightsModule {}
