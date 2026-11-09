import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DataSource, In } from 'typeorm';
import { Order } from './entities/order.entity';
import { Flight } from '../flights/entities/flight.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { Airplane } from '../airplanes/entities/airplane.entity';
import { User } from '../users/entities/user.entity';
import { OrderUpsertService } from './order.upsert.service';
import { CreateOrderDto } from './dto/create.order.dto';
import { FlightClasses } from '../flights/types/flight.classes';
import { FlightCode } from '../flights/valueObjects/flight.code';
import { FlightClassPriceIncrements } from '../flights/valueObjects/flight.class.price.increments';
import { Percentage } from '../shared/common/percentage';

type FindOptions = {
  where: { id?: string | ReturnType<typeof In>; flights?: { id: string } };
  lock?: unknown;
};

describe('OrderUpsertService', () => {
  let service: OrderUpsertService;
  let flights: Map<string, Flight>;
  let ordersByFlight: Map<string, Order[]>;
  let user: User | null;
  let manager: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    increment: jest.Mock;
  };

  const airline = Object.assign(new Airline(), {
    id: 'airline-id',
    code: 'AL',
    luggageRules: null,
    redeemFee: 0,
    flightClassPriceIncrements: [
      Object.assign(new FlightClassPriceIncrements(), {
        class: FlightClasses.Economy,
        increment: new Percentage(0),
      }),
    ],
  });

  // 4 economy seats and 2 business seats
  const buildFlight = (id: string, correlative: number): Flight => {
    const flight = Object.assign(new Flight(), {
      id,
      code: new FlightCode('AL', correlative),
      airline,
      basePrice: 100,
      distance: 500,
      airplane: Object.assign(new Airplane(), {
        seatsConfig: [
          {
            class: FlightClasses.Business,
            rowsQuantity: 1,
            columnsQuantity: 2,
          },
          { class: FlightClasses.Economy, rowsQuantity: 2, columnsQuantity: 2 },
        ],
      }),
    });
    flight.setSeats();
    return flight;
  };

  const soldOrder = (flightId: string, seats: number, cls: FlightClasses) =>
    Object.assign(new Order(), {
      class: cls,
      flightSelections: [
        { flightId, purchaseQuantity: seats, redeemQuantity: 0 },
      ],
    });

  const orderDto = (
    selections: Array<[string, number]>,
    cls = FlightClasses.Economy,
  ): CreateOrderDto =>
    ({
      id: 'order-id',
      flightSelection: selections.map(([flightId, purchaseQuantity]) => ({
        flightId,
        purchaseQuantity,
        redeemQuantity: 0,
      })),
      handBaggageQuantity: 0,
      checkedLuggageQuantity: 0,
      class: cls,
      userId: 'user-id',
    }) as CreateOrderDto;

  beforeEach(async () => {
    flights = new Map([
      ['flight-b', buildFlight('flight-b', 2)],
      ['flight-a', buildFlight('flight-a', 1)],
    ]);
    ordersByFlight = new Map();
    user = Object.assign(new User(), { id: 'user-id', accumulatedMiles: 0 });

    manager = {
      findOne: jest.fn((entity: unknown, options: FindOptions) => {
        if (entity === User) return Promise.resolve(user);
        return Promise.resolve(flights.get(options.where.id as string) ?? null);
      }),
      find: jest.fn((entity: unknown, options: FindOptions) => {
        if (entity === Order) {
          return Promise.resolve(
            ordersByFlight.get(options.where.flights!.id) ?? [],
          );
        }
        return Promise.resolve([...flights.values()]);
      }),
      create: jest.fn((_entity: unknown, value: Partial<Order>) =>
        Object.assign(new Order(), value),
      ),
      save: jest.fn((saved: Order) => Promise.resolve(saved)),
      increment: jest.fn(() => Promise.resolve()),
    };
    const transaction = jest.fn((work: (m: typeof manager) => Promise<Order>) =>
      work(manager),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderUpsertService,
        { provide: DataSource, useValue: { transaction } },
      ],
    }).compile();

    service = module.get<OrderUpsertService>(OrderUpsertService);
  });

  const lockedFlightIds = (): string[] =>
    (manager.findOne.mock.calls as Array<[unknown, FindOptions]>)
      .filter(([entity, options]) => entity === Flight && options.lock)
      .map(([, options]) => options.where.id as string);

  it('locks each flight once, in id order', async () => {
    await service.create(
      orderDto([
        ['flight-b', 1],
        ['flight-a', 1],
        ['flight-b', 1],
      ]),
    );

    expect(lockedFlightIds()).toEqual(['flight-a', 'flight-b']);
  });

  it('stores the seats taken on each flight and prices the order', async () => {
    const order = await service.create(
      orderDto([
        ['flight-a', 2],
        ['flight-b', 1],
      ]),
    );

    expect(order.flightSelections).toEqual([
      { flightId: 'flight-a', purchaseQuantity: 2, redeemQuantity: 0 },
      { flightId: 'flight-b', purchaseQuantity: 1, redeemQuantity: 0 },
    ]);
    expect(order.passengersQuantity).toBe(3);
    expect(order.grandTotal).toBe(300);
    expect(manager.save).toHaveBeenCalledWith(order);
  });

  it('bumps the version of every flight in the order after saving it', async () => {
    await service.create(orderDto([['flight-a', 1]]));

    expect(manager.increment).toHaveBeenCalledWith(
      Flight,
      { id: In(['flight-a']) },
      'version',
      1,
    );
    expect(manager.save.mock.invocationCallOrder[0]).toBeLessThan(
      manager.increment.mock.invocationCallOrder[0],
    );
  });

  it('accepts an order that takes the last seats of its class', async () => {
    ordersByFlight.set('flight-a', [
      soldOrder('flight-a', 3, FlightClasses.Economy),
    ]);

    await expect(
      service.create(orderDto([['flight-a', 1]])),
    ).resolves.toBeDefined();
  });

  it('returns a conflict and saves nothing when the class has too few seats left', async () => {
    ordersByFlight.set('flight-a', [
      soldOrder('flight-a', 3, FlightClasses.Economy),
      // Other classes and flights don't count
      soldOrder('flight-a', 2, FlightClasses.Business),
      soldOrder('flight-b', 4, FlightClasses.Economy),
    ]);

    const result = service.create(orderDto([['flight-a', 2]]));

    await expect(result).rejects.toThrow(ConflictException);
    await expect(result).rejects.toThrow('Flight AL1 has 1 economy seats left');
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.increment).not.toHaveBeenCalled();
  });

  it('adds up repeated selections of the same flight', async () => {
    const result = service.create(
      orderDto(
        [
          ['flight-a', 1],
          ['flight-a', 2],
        ],
        FlightClasses.Business,
      ),
    );

    await expect(result).rejects.toThrow('has 2 business seats left');
  });

  it('returns not found for a missing flight', async () => {
    const result = service.create(orderDto([['missing-id', 1]]));

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('Flight missing-id not found');
  });

  it('returns not found for a missing user', async () => {
    user = null;

    const result = service.create(orderDto([['flight-a', 1]]));

    await expect(result).rejects.toThrow(NotFoundException);
    await expect(result).rejects.toThrow('User user-id not found');
  });
});
