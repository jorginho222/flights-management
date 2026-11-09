import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource } from 'typeorm';
import { Flight } from './entities/flight.entity';
import { CreateFlightDto } from './dto/create.flight.dto';
import { AirplanesService } from '../airplanes/airplanes.service';
import { FlightStatus } from './types/flight.status';
import { UpdateFlightScheduleDto } from './dto/update.flight.schedule.dto';
import { UpdateFlightStatusDto } from './dto/update.flight.status.dto';
import {
  FLIGHT_UPDATED,
  FlightUpdatedEvent,
} from './events/flight.updated.event';
import {
  findAirport,
  lockAirline,
  nextFlightCode,
  saveWithFlightCode,
} from './flights.lookups';

@Injectable()
export class FlightsUpsertService {
  constructor(
    private readonly airplaneService: AirplanesService,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async create(flightDto: CreateFlightDto): Promise<Flight> {
    const airplaneSearch = await this.airplaneService.search({
      where: {
        id: flightDto.airplane.id,
      },
    });
    if (airplaneSearch.length === 0) {
      throw new NotFoundException(
        `Airplane ${flightDto.airplane.id} not found`,
      );
    }

    return await this.dataSource.transaction(async (manager) => {
      const airline = await lockAirline(manager, flightDto.airline.id);

      const flight = manager.create(Flight, {
        id: flightDto.id,
        code: await nextFlightCode(manager, airline),
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
      const origin = await findAirport(manager, flightDto.origin.id);
      const destination = await findAirport(manager, flightDto.destination.id);
      this.applyFlightRules(() => {
        flight.setRoute(origin, destination);
        flight.validate();
      });
      flight.setSeats();

      return await saveWithFlightCode(manager, flight);
    });
  }

  async updateSchedule(flightDto: UpdateFlightScheduleDto): Promise<Flight> {
    const flight = await this.updateLockedFlight(flightDto.id, (flight) => {
      this.applyFlightRules(() =>
        flight.setSchedule(flightDto.departure, flightDto.arrival),
      );
    });
    this.emitFlightUpdated(flight);
    return flight;
  }

  async updateStatus(flightDto: UpdateFlightStatusDto): Promise<Flight> {
    const flight = await this.updateLockedFlight(flightDto.id, (flight) => {
      flight.setStatus(flightDto.status as FlightStatus);
    });
    this.emitFlightUpdated(flight);
    return flight;
  }

  // Runs after the transaction commits, so a rollback never reaches clients
  private emitFlightUpdated(flight: Flight): void {
    this.eventEmitter.emit(
      FLIGHT_UPDATED,
      FlightUpdatedEvent.fromFlight(flight),
    );
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

  private async updateLockedFlight(
    flightId: string,
    applyChange: (flight: Flight) => void,
  ): Promise<Flight> {
    return await this.dataSource.transaction(async (manager) => {
      const flight = await manager.findOne(Flight, {
        where: { id: flightId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!flight) throw new NotFoundException(`Flight ${flightId} not found`);

      applyChange(flight);

      return await manager.save(flight);
    });
  }
}
