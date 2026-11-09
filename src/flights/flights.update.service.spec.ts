import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, QueryFailedError } from 'typeorm';
import { FlightsUpdateService } from './flights.update.service';
import { Flight } from './entities/flight.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { Airplane } from '../airplanes/entities/airplane.entity';
import { Airport } from '../airports/entities/airport.entity';
import { Order } from '../orders/entities/order.entity';
import { UpdateFlightDto } from './dto/update.flight.dto';
import { FlightStatus } from './types/flight.status';
import { FlightClasses } from './types/flight.classes';
import { FlightCode } from './valueObjects/flight.code';

type FindOptions = {
  where: { id?: string; flights?: { id: string } };
  lock?: unknown;
  relations?: string[];
};

describe('FlightsUpdateService', () => {
  let service: FlightsUpdateService;
  let flight: Flight;
  let orders: Order[];
  let rows: Map<unknown, Map<string, unknown>>;
  let lastCorrelative: { last: number | null };
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let transaction: jest.Mock;

  const flightId = 'flight-id';

  const airport = (id: string, iataCode: string, lat: number, lon: number) =>
    Object.assign(new Airport(), {
      id,
      iataCode,
      latitude: lat,
      longitude: lon,
    });
  const ezeiza = airport('eze-id', 'EZE', -34.8222, -58.5358);
  const cordoba = airport('cor-id', 'COR', -31.3236, -64.208);
  const mendoza = airport('mdz-id', 'MDZ', -32.8317, -68.7929);

  const airplane = (id: string, economyRows: number) =>
    Object.assign(new Airplane(), {
      id,
      model: id,
      seatsConfig: [
        {
          class: FlightClasses.Economy,
          rowsQuantity: economyRows,
          columnsQuantity: 2,
        },
      ],
    });
  const currentAirplane = airplane('airplane-id', 3);
  const smallAirplane = airplane('small-id', 1);

  const currentAirline = Object.assign(new Airline(), {
    id: 'airline-id',
    code: 'AL',
  });
  const otherAirline = Object.assign(new Airline(), {
    id: 'other-airline-id',
    code: 'LA',
  });

  const order = (seats: number): Order =>
    Object.assign(new Order(), {
      class: FlightClasses.Economy,
      flightSelections: [
        { flightId, purchaseQuantity: seats, redeemQuantity: 0 },
      ],
    });

  // The dto that leaves every field as stored
  const unchanged = (): UpdateFlightDto =>
    ({
      airline: { id: 'airline-id' },
      airplane: { id: 'airplane-id' },
      origin: { id: 'eze-id' },
      destination: { id: 'cor-id' },
      basePrice: 100,
      version: 2,
    }) as unknown as UpdateFlightDto;

  beforeEach(async () => {
    flight = Object.assign(new Flight(), {
      id: flightId,
      code: new FlightCode('AL', 4),
      status: FlightStatus.Scheduled,
      origin: ezeiza,
      destination: cordoba,
      distance: 400,
      airline: currentAirline,
      airplane: currentAirplane,
      basePrice: 100,
      version: 2,
    });
    flight.setSeats();
    orders = [];
    lastCorrelative = { last: 9 };

    rows = new Map<unknown, Map<string, unknown>>([
      [Flight, new Map([[flightId, flight]])],
      [Airport, new Map([ezeiza, cordoba, mendoza].map((a) => [a.id, a]))],
      [
        Airplane,
        new Map([currentAirplane, smallAirplane].map((a) => [a.id, a])),
      ],
      [Airline, new Map([currentAirline, otherAirline].map((a) => [a.id, a]))],
    ]);

    const queryBuilder = {
      select: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      getRawOne: jest.fn(() => Promise.resolve(lastCorrelative)),
    };
    manager = {
      findOne: jest.fn((entity: unknown, options: FindOptions) =>
        Promise.resolve(rows.get(entity)?.get(options.where.id!) ?? null),
      ),
      find: jest.fn(() => Promise.resolve(orders)),
      save: jest.fn((saved: Flight) => Promise.resolve(saved)),
      createQueryBuilder: jest.fn(() => queryBuilder),
    };
    transaction = jest.fn((work: (m: typeof manager) => Promise<Flight>) =>
      work(manager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsUpdateService,
        { provide: DataSource, useValue: { transaction } },
      ],
    }).compile();

    service = module.get<FlightsUpdateService>(FlightsUpdateService);
  });

  const findOneCalls = (): Array<[unknown, FindOptions]> =>
    manager.findOne.mock.calls as Array<[unknown, FindOptions]>;

  it('locks the flight before reading it and its orders', async () => {
    await service.update(flightId, unchanged());

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(findOneCalls()[0]).toEqual([
      Flight,
      { where: { id: flightId }, lock: { mode: 'pessimistic_write' } },
    ]);
    expect(manager.find).toHaveBeenCalledWith(Order, {
      where: { flights: { id: flightId } },
    });
  });

  it('returns not found when the flight does not exist', async () => {
    const result = service.update('missing-id', unchanged());

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('Flight missing-id not found');
  });

  it('saves a new base price, rounded to cents', async () => {
    const result = await service.update(flightId, {
      ...unchanged(),
      basePrice: 150.004,
    });

    expect(result.basePrice).toBe(150);
    expect(manager.save).toHaveBeenCalledWith(flight);
  });

  it('does not look up or lock anything for fields left as stored', async () => {
    await service.update(flightId, unchanged());

    const lookedUp = findOneCalls().map(([entity]) => entity);
    expect(lookedUp).toEqual([Flight, Flight]);
    expect(flight.code.toString()).toBe('AL4');
  });

  it('sets the route from the stored airports', async () => {
    const result = await service.update(flightId, {
      ...unchanged(),
      destination: { id: 'mdz-id' },
    } as UpdateFlightDto);

    expect(result.destination).toBe(mendoza);
    expect(result.distance).toBeGreaterThan(550);
  });

  it('returns bad request for a route that starts and ends at the same airport', async () => {
    const result = service.update(flightId, {
      ...unchanged(),
      destination: { id: 'eze-id' },
    } as UpdateFlightDto);

    await expect(result).rejects.toThrow(BadRequestException);
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns not found for a missing airport', async () => {
    const result = service.update(flightId, {
      ...unchanged(),
      origin: { id: 'missing-id' },
    } as UpdateFlightDto);

    await expect(result).rejects.toThrow('Airport missing-id not found');
  });

  describe('airline change', () => {
    const toOtherAirline = (): UpdateFlightDto =>
      ({
        ...unchanged(),
        airline: { id: 'other-airline-id' },
      }) as UpdateFlightDto;

    it('locks the new airline after the flight and gives the next code under its prefix', async () => {
      const result = await service.update(flightId, toOtherAirline());

      const airlineCall = findOneCalls().find(([entity]) => entity === Airline);
      expect(airlineCall?.[1]).toEqual({
        where: { id: 'other-airline-id' },
        lock: { mode: 'pessimistic_write' },
      });
      expect(findOneCalls()[0][0]).toBe(Flight);
      expect(result.airline).toBe(otherAirline);
      expect(result.code.toString()).toBe('LA10');
    });

    it('returns not found for a missing airline', async () => {
      const result = service.update(flightId, {
        ...unchanged(),
        airline: { id: 'missing-id' },
      } as UpdateFlightDto);

      await expect(result).rejects.toThrow(NotFoundException);
      await expect(result).rejects.toThrow('Airline missing-id not found');
    });

    it('returns a conflict when the new code is already taken', async () => {
      manager.save.mockRejectedValue(
        new QueryFailedError('query', [], {
          name: 'error',
          message: 'duplicate key',
          code: '23505',
          constraint: 'UQ_flight_code',
        } as Error),
      );

      const result = service.update(flightId, toOtherAirline());

      await expect(result).rejects.toThrow(ConflictException);
      await expect(result).rejects.toThrow('Flight code LA10 is already taken');
    });

    it('returns a conflict and saves nothing when the flight has orders', async () => {
      orders = [order(1)];

      const result = service.update(flightId, toOtherAirline());

      await expect(result).rejects.toThrow(ConflictException);
      await expect(result).rejects.toThrow('has orders');
      expect(manager.save).not.toHaveBeenCalled();
    });
  });

  describe('airplane change', () => {
    const toSmallAirplane = (): UpdateFlightDto =>
      ({ ...unchanged(), airplane: { id: 'small-id' } }) as UpdateFlightDto;

    it('rebuilds the seats when the orders fit', async () => {
      orders = [order(2)];

      const result = await service.update(flightId, toSmallAirplane());

      expect(result.airplane).toBe(smallAirplane);
      expect(result.seats).toHaveLength(2);
    });

    it('returns a conflict when orders hold more seats than the new airplane has', async () => {
      orders = [order(2), order(1)];

      const result = service.update(flightId, toSmallAirplane());

      await expect(result).rejects.toThrow(ConflictException);
      await expect(result).rejects.toThrow(
        'Airplane small-id has 2 economy seats, but orders hold 3',
      );
      expect(manager.save).not.toHaveBeenCalled();
    });

    it('returns a conflict when a seat is reserved', async () => {
      flight.seats[0].passengerId = 'passenger-id';

      const result = service.update(flightId, toSmallAirplane());

      await expect(result).rejects.toThrow(ConflictException);
      await expect(result).rejects.toThrow('only its base price can change');
    });

    it('returns not found for a missing airplane', async () => {
      const result = service.update(flightId, {
        ...unchanged(),
        airplane: { id: 'missing-id' },
      } as UpdateFlightDto);

      await expect(result).rejects.toThrow('Airplane missing-id not found');
    });
  });

  it('returns a conflict when orders arrived after the form loaded the flight', async () => {
    orders = [order(1)];

    const result = service.update(flightId, {
      ...unchanged(),
      basePrice: 120,
      version: 1,
    });

    await expect(result).rejects.toThrow(ConflictException);
    await expect(result).rejects.toThrow('reload it and try again');
    expect(manager.save).not.toHaveBeenCalled();
  });

  it('returns a conflict for a flight that is no longer scheduled', async () => {
    flight.status = FlightStatus.Delayed;

    const result = service.update(flightId, { ...unchanged(), basePrice: 120 });

    await expect(result).rejects.toThrow(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });
});
