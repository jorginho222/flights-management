import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { FlightsUpsertService } from './flights.upsert.service';
import { Flight } from './entities/flight.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { AirplanesService } from '../airplanes/airplanes.service';
import { FlightStatus } from './types/flight.status';
import { UpdateFlightScheduleDto } from './dto/update.flight.schedule.dto';
import { UpdateFlightStatusDto } from './dto/update.flight.status.dto';
import { CreateFlightDto } from './dto/create.flight.dto';
import { Airplane } from '../airplanes/entities/airplane.entity';
import { FlightClasses } from './types/flight.classes';
import { Airport } from '../airports/entities/airport.entity';
import {
  FLIGHT_UPDATED,
  FlightUpdatedEvent,
} from './events/flight.updated.event';

const uniqueViolation = (constraint: string): QueryFailedError =>
  new QueryFailedError('query', [], {
    name: 'error',
    message: 'duplicate key value violates unique constraint',
    code: '23505',
    constraint,
  } as Error);

describe('FlightsUpsertService', () => {
  let service: FlightsUpsertService;
  let manager: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let lastCorrelative: { last: number | null } | undefined;
  let queryBuilder: Record<string, jest.Mock>;
  let transaction: jest.Mock;
  let airplaneSearch: jest.Mock;
  let emit: jest.Mock;
  let flight: Flight;

  const flightId = 'flight-id';
  const departure = new Date('2030-01-01T10:00:00Z');
  const arrival = new Date('2030-01-01T12:00:00Z');

  const statusDto = {
    id: flightId,
    status: FlightStatus.Delayed,
  } as UpdateFlightStatusDto;

  const scheduleDto = (newDeparture: Date, newArrival: Date) =>
    ({
      id: flightId,
      departure: newDeparture,
      arrival: newArrival,
    }) as UpdateFlightScheduleDto;

  beforeEach(async () => {
    flight = Object.assign(new Flight(), { id: flightId, version: 3 });
    flight.status = FlightStatus.Scheduled;
    flight.departure = departure;
    flight.arrival = arrival;

    lastCorrelative = { last: null };
    queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(() => Promise.resolve(lastCorrelative)),
    };
    manager = {
      findOne: jest.fn().mockResolvedValue(flight),
      save: jest.fn((saved: Flight) => Promise.resolve(saved)),
      create: jest.fn((_entity: unknown, value: Partial<Flight>) =>
        Object.assign(new Flight(), value),
      ),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    transaction = jest.fn((work: (m: typeof manager) => Promise<Flight>) =>
      work(manager),
    );
    airplaneSearch = jest.fn();
    emit = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsUpsertService,
        { provide: AirplanesService, useValue: { search: airplaneSearch } },
        { provide: DataSource, useValue: { transaction } },
        { provide: EventEmitter2, useValue: { emit } },
      ],
    }).compile();

    service = module.get<FlightsUpsertService>(FlightsUpsertService);
  });

  const expectFlightLockedAndSavedInTransaction = () => {
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(manager.findOne).toHaveBeenCalledWith(Flight, {
      where: { id: flightId },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.save).toHaveBeenCalledWith(flight);
  };

  describe('create', () => {
    const buildAirport = (
      id: string,
      iataCode: string,
      latitude: number,
      longitude: number,
    ): Airport =>
      Object.assign(new Airport(), { id, iataCode, latitude, longitude });

    const ezeiza = buildAirport('eze-id', 'EZE', -34.8222, -58.5358);
    const cordoba = buildAirport('cor-id', 'COR', -31.3236, -64.208);
    const airports = new Map([ezeiza, cordoba].map((a) => [a.id, a]));

    const createDto = {
      id: flightId,
      airline: { id: 'airline-id', code: 'AL' },
      airplane: { id: 'airplane-id' },
      origin: { id: 'eze-id' },
      destination: { id: 'cor-id' },
      departure,
      arrival,
      basePrice: 100,
    } as unknown as CreateFlightDto;

    const airplaneWith = (passengersCapacity: number): Airplane =>
      Object.assign(new Airplane(), {
        id: 'airplane-id',
        passengersCapacity,
        seatsConfig: [
          { class: FlightClasses.Economy, rowsQuantity: 2, columnsQuantity: 3 },
        ],
      });

    const airline = Object.assign(new Airline(), {
      id: 'airline-id',
      code: 'AL',
    });

    beforeEach(() => {
      airplaneSearch.mockResolvedValue([airplaneWith(6)]);
      manager.findOne.mockImplementation(
        (entity: unknown, options: { where: { id: string } }) =>
          Promise.resolve(
            entity === Airline
              ? airline
              : (airports.get(options.where.id) ?? null),
          ),
      );
    });

    it('sets the route from the stored airports and computes the distance in miles', async () => {
      const created = await service.create({
        ...createDto,
        origin: { id: 'eze-id', latitude: 0, longitude: 0 },
      } as unknown as CreateFlightDto);

      expect(created.origin).toBe(ezeiza);
      expect(created.destination).toBe(cordoba);
      expect(created.distance).toBeGreaterThan(395);
      expect(created.distance).toBeLessThan(410);
    });

    it('returns not found and does not save when an airport does not exist', async () => {
      const result = service.create({
        ...createDto,
        destination: { id: 'missing-id' },
      } as unknown as CreateFlightDto);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Airport missing-id not found');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns bad request for a route that starts and ends at the same airport', async () => {
      const result = service.create({
        ...createDto,
        destination: { id: 'eze-id' },
      } as unknown as CreateFlightDto);

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow(
        'Origin and destination must be different',
      );

      expect(manager.save).not.toHaveBeenCalled();
    });

    it('builds the seats from the airplane seat config', async () => {
      const created = await service.create(createDto);

      expect(created.seats).toHaveLength(6);
      expect(manager.save).toHaveBeenCalledTimes(1);
    });

    it('locks the airline and saves the flight in one transaction', async () => {
      await service.create(createDto);

      expect(transaction).toHaveBeenCalledTimes(1);
      expect(manager.findOne).toHaveBeenCalledWith(Airline, {
        where: { id: 'airline-id' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(manager.findOne.mock.invocationCallOrder[0]).toBeLessThan(
        queryBuilder.getRawOne.mock.invocationCallOrder[0],
      );
    });

    it('starts the correlative at 1 for an airline without flights', async () => {
      const created = await service.create(createDto);

      expect(created.code.toString()).toBe('AL1');
      expect(queryBuilder.where).toHaveBeenCalledWith(expect.any(String), {
        prefix: 'AL',
      });
    });

    it('uses the next correlative after the last one', async () => {
      lastCorrelative = { last: 41 };

      const created = await service.create(createDto);

      expect(created.code.getCorrelative()).toBe(42);
    });

    it('takes the prefix from the stored airline, not the request', async () => {
      const created = await service.create({
        ...createDto,
        airline: { ...createDto.airline, code: 'ZZ' },
      } as unknown as CreateFlightDto);

      expect(created.code.getPrefix()).toBe('AL');
    });

    it('returns bad request when the departure is after the arrival', async () => {
      const result = service.create({
        ...createDto,
        departure: arrival,
        arrival: departure,
      } as unknown as CreateFlightDto);

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('Departure must be before arrival');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns not found and does not save when the airline does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      const result = service.create(createDto);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Airline airline-id not found');
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns not found and does not open a transaction when the airplane does not exist', async () => {
      airplaneSearch.mockResolvedValue([]);

      const result = service.create(createDto);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Airplane airplane-id not found');
      expect(transaction).not.toHaveBeenCalled();
    });

    it('returns a conflict when the flight code is already taken', async () => {
      manager.save.mockRejectedValue(uniqueViolation('UQ_flight_code'));

      const result = service.create(createDto);

      await expect(result).rejects.toThrow(ConflictException);
      await expect(result).rejects.toThrow('Flight code AL1 is already taken');
    });

    it('rethrows unique violations on other constraints', async () => {
      const error = uniqueViolation('PK_flight');
      manager.save.mockRejectedValue(error);

      await expect(service.create(createDto)).rejects.toBe(error);
    });
  });

  describe('updateStatus', () => {
    it('locks the flight, then saves the new status in one transaction', async () => {
      const result = await service.updateStatus(statusDto);

      expectFlightLockedAndSavedInTransaction();
      expect(result).toBe(flight);
      expect(result.status).toBe(FlightStatus.Delayed);
    });

    it('applies the change to the flight read under the lock', async () => {
      const savedStatuses: FlightStatus[] = [];
      manager.save.mockImplementation((saved: Flight) => {
        savedStatuses.push(saved.status);
        return Promise.resolve(saved);
      });

      await service.updateStatus(statusDto);

      expect(savedStatuses).toEqual([FlightStatus.Delayed]);
      expect(manager.findOne.mock.invocationCallOrder[0]).toBeLessThan(
        manager.save.mock.invocationCallOrder[0],
      );
    });

    it('emits flight.updated with the saved flight after the transaction', async () => {
      await service.updateStatus(statusDto);

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(
        FLIGHT_UPDATED,
        new FlightUpdatedEvent(
          flightId,
          FlightStatus.Delayed,
          departure,
          arrival,
          3,
        ),
      );
      expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
        emit.mock.invocationCallOrder[0],
      );
    });

    it('does not save when the flight does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      const result = service.updateStatus(statusDto);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Flight flight-id not found');

      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });

  describe('updateSchedule', () => {
    it('locks the flight, then saves a later schedule as delayed', async () => {
      const newDeparture = new Date('2030-01-01T11:00:00Z');
      const newArrival = new Date('2030-01-01T13:00:00Z');

      const result = await service.updateSchedule(
        scheduleDto(newDeparture, newArrival),
      );

      expectFlightLockedAndSavedInTransaction();
      expect(result.departure).toBe(newDeparture);
      expect(result.arrival).toBe(newArrival);
      expect(result.status).toBe(FlightStatus.Delayed);
    });

    it('saves an earlier schedule as advanced', async () => {
      const result = await service.updateSchedule(
        scheduleDto(
          new Date('2030-01-01T09:00:00Z'),
          new Date('2030-01-01T11:00:00Z'),
        ),
      );

      expect(result.status).toBe(FlightStatus.Advanced);
    });

    it('emits flight.updated with the new schedule and status', async () => {
      const newDeparture = new Date('2030-01-01T11:00:00Z');
      const newArrival = new Date('2030-01-01T13:00:00Z');

      await service.updateSchedule(scheduleDto(newDeparture, newArrival));

      expect(emit).toHaveBeenCalledTimes(1);
      expect(emit).toHaveBeenCalledWith(
        FLIGHT_UPDATED,
        new FlightUpdatedEvent(
          flightId,
          FlightStatus.Delayed,
          newDeparture,
          newArrival,
          3,
        ),
      );
    });

    it('returns bad request and does not save an invalid schedule', async () => {
      const result = service.updateSchedule(
        scheduleDto(
          new Date('2030-01-01T15:00:00Z'),
          new Date('2030-01-01T11:00:00Z'),
        ),
      );

      await expect(result).rejects.toThrow(BadRequestException);
      await expect(result).rejects.toThrow('Departure must be before arrival');

      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });

    it('does not save when the flight does not exist', async () => {
      manager.findOne.mockResolvedValue(null);

      const result = service.updateSchedule(scheduleDto(departure, arrival));

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Flight flight-id not found');

      expect(manager.save).not.toHaveBeenCalled();
      expect(emit).not.toHaveBeenCalled();
    });
  });
});
