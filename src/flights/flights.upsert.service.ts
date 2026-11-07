import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Flight } from './entities/flight.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { Airport } from '../airports/entities/airport.entity';
import { CreateFlightDto } from './dto/create.flight.dto';
import { AirplanesService } from '../airplanes/airplanes.service';
import { FlightStatus } from './types/flight.status';
import { FlightCode } from './valueObjects/flight.code';
import { UpdateFlightScheduleDto } from './dto/update.flight.schedule.dto';
import { UpdateFlightStatusDto } from './dto/update.flight.status.dto';
import { isUniqueViolation } from '../shared/common/database.errors';

@Injectable()
export class FlightsUpsertService {
  constructor(
    private readonly airplaneService: AirplanesService,
    private readonly dataSource: DataSource,
  ) {}

  async create(flightDto: CreateFlightDto): Promise<Flight> {
    const airplaneSearch = await this.airplaneService.search({
      where: {
        id: flightDto.airplane.id,
      },
    });
    if (airplaneSearch.length === 0) throw new Error('Airplane not found');

    return await this.dataSource.transaction(async (manager) => {
      // Locking the airline makes concurrent creations for the same airline
      // wait here, so two flights can't read the same last correlative.
      const airline = await manager.findOne(Airline, {
        where: { id: flightDto.airline.id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!airline) throw new Error('Airline not found');

      const lastCorrelative = await this.getLastCodeCorrelative(
        manager,
        airline.code,
      );

      const flight = manager.create(Flight, {
        id: flightDto.id,
        code: new FlightCode(airline.code, lastCorrelative + 1),
        airline,
        airplane: airplaneSearch[0],
        departure: flightDto.departure,
        arrival: flightDto.arrival,
        passengers: [],
        orders: [],
        status: FlightStatus.Scheduled,
        basePrice: flightDto.basePrice,
      });

      // The stored airports, not the request, give the route and its distance
      const origin = await this.findAirport(manager, flightDto.origin.id);
      const destination = await this.findAirport(
        manager,
        flightDto.destination.id,
      );
      this.applyFlightRules(() => {
        flight.setRoute(origin, destination);
        flight.validate();
      });
      flight.setSeats();

      try {
        return await manager.save(flight);
      } catch (error) {
        // The airline lock makes this rare, but a flight under another
        // airline can hold the same prefix, e.g. after an airline code change.
        if (isUniqueViolation(error, 'UQ_flight_code')) {
          throw new ConflictException(
            `Flight code ${flight.code.toString()} is already taken`,
          );
        }
        throw error;
      }
    });
  }

  async updateSchedule(flightDto: UpdateFlightScheduleDto) {
    return await this.updateLockedFlight(flightDto.id, (flight) => {
      this.applyFlightRules(() =>
        flight.setSchedule(flightDto.departure, flightDto.arrival),
      );
    });
  }

  async updateStatus(flightDto: UpdateFlightStatusDto) {
    return await this.updateLockedFlight(flightDto.id, (flight) => {
      flight.setStatus(flightDto.status as FlightStatus);
    });
  }

  // Flight throws plain Errors for invalid routes and schedules, which are
  // client mistakes, so they surface as 400 instead of 500
  private applyFlightRules(change: () => void): void {
    try {
      change();
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  private async findAirport(
    manager: EntityManager,
    id: string,
  ): Promise<Airport> {
    const airport = await manager.findOne(Airport, { where: { id } });
    if (!airport) throw new NotFoundException(`Airport ${id} not found`);

    return airport;
  }

  private async getLastCodeCorrelative(
    manager: EntityManager,
    prefix: string,
  ): Promise<number> {
    const result = await manager
      .createQueryBuilder(Flight, 'flight')
      .select("MAX((flight.code ->> 'correlative')::int)", 'last')
      .where("flight.code ->> 'prefix' = :prefix", { prefix })
      .getRawOne<{ last: number | null }>();

    return Number(result?.last ?? 0);
  }

  private async updateLockedFlight(
    flightId: string,
    applyChange: (flight: Flight) => void,
  ): Promise<Flight> {
    return await this.dataSource.transaction(async (manager) => {
      const flight = await manager.findOne(Flight, {
        where: { id: flightId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!flight) throw new Error('Flight not found');

      applyChange(flight);

      return await manager.save(flight);
    });
  }
}
