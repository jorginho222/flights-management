import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DataSource, FindManyOptions, In, LessThan } from 'typeorm';
import { Flight } from './entities/flight.entity';
import { FlightsDelayService } from './flights.delay.service';
import {
  FLIGHT_UPDATED,
  FlightUpdatedEvent,
} from './events/flight.updated.event';
import { DELAY_TOLERANCE_MINUTES } from './flight.delay.tolerance';
import { FlightStatus, PRE_DEPARTURE_STATUSES } from './types/flight.status';

describe('FlightsDelayService', () => {
  let service: FlightsDelayService;
  let find: jest.Mock<Promise<Flight[]>, [FindManyOptions<Flight>]>;
  let manager: { findOne: jest.Mock; save: jest.Mock };
  let transaction: jest.Mock;
  let emit: jest.Mock;
  let stored: Map<string, Flight>;

  const now = new Date('2030-01-01T10:30:00Z');

  const flightDeparting = (id: string, departure: string): Flight =>
    Object.assign(new Flight(), {
      id,
      status: FlightStatus.Scheduled,
      departure: new Date(departure),
      arrival: new Date('2030-01-01T14:00:00Z'),
      wasRescheduled: false,
      isDelayed: false,
      version: 2,
    });

  beforeEach(async () => {
    stored = new Map();
    find = jest.fn<Promise<Flight[]>, [FindManyOptions<Flight>]>(() =>
      Promise.resolve([...stored.keys()].map((id) => ({ id }) as Flight)),
    );
    manager = {
      findOne: jest.fn(
        (_entity: unknown, { where }: { where: { id: string } }) =>
          Promise.resolve(stored.get(where.id) ?? null),
      ),
      save: jest.fn((flight: Flight) => Promise.resolve(flight)),
    };
    transaction = jest.fn(
      (work: (m: typeof manager) => Promise<Flight | null>) => work(manager),
    );
    emit = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsDelayService,
        { provide: getRepositoryToken(Flight), useValue: { find } },
        { provide: DataSource, useValue: { transaction } },
        { provide: EventEmitter2, useValue: { emit } },
        { provide: DELAY_TOLERANCE_MINUTES, useValue: 15 },
      ],
    }).compile();

    service = module.get(FlightsDelayService);
  });

  it('searches undelayed flights before departure whose departure plus the tolerance has passed', async () => {
    await service.markDelayedFlights(now);

    expect(find).toHaveBeenCalledWith({
      select: { id: true },
      where: {
        status: In([...PRE_DEPARTURE_STATUSES]),
        isDelayed: false,
        departure: LessThan(new Date('2030-01-01T10:15:00Z')),
      },
      order: { id: 'ASC' },
    });
  });

  it('locks each overdue flight, marks it delayed and emits flight.updated', async () => {
    const flight = flightDeparting('a', '2030-01-01T10:00:00Z');
    stored.set('a', flight);

    const marked = await service.markDelayedFlights(now);

    expect(marked).toEqual([flight]);
    expect(flight.isDelayed).toBe(true);
    expect(manager.findOne).toHaveBeenCalledWith(Flight, {
      where: { id: 'a' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(manager.save).toHaveBeenCalledWith(flight);
    expect(emit).toHaveBeenCalledWith(
      FLIGHT_UPDATED,
      FlightUpdatedEvent.fromFlight(flight),
    );
    expect(transaction.mock.invocationCallOrder[0]).toBeLessThan(
      emit.mock.invocationCallOrder[0],
    );
  });

  it('skips a flight that changed after the search, such as one that departed', async () => {
    const departed = flightDeparting('a', '2030-01-01T10:00:00Z');
    departed.status = FlightStatus.Departed;
    const rescheduled = flightDeparting('b', '2030-01-01T12:00:00Z');
    stored.set('a', departed).set('b', rescheduled);

    const marked = await service.markDelayedFlights(now);

    expect(marked).toEqual([]);
    expect(manager.save).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it('keeps marking the other flights when one fails', async () => {
    const failing = flightDeparting('a', '2030-01-01T10:00:00Z');
    const other = flightDeparting('b', '2030-01-01T09:00:00Z');
    stored.set('a', failing).set('b', other);
    manager.save.mockRejectedValueOnce(new Error('connection lost'));
    jest.spyOn(service['logger'], 'error').mockImplementation(() => undefined);

    const marked = await service.markDelayedFlights(now);

    expect(marked).toEqual([other]);
    expect(emit).toHaveBeenCalledTimes(1);
  });
});
