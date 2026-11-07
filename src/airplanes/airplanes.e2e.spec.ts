import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { DataSource, DeepPartial, Repository } from 'typeorm';
import { Airplane } from './entities/airplane.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { Airport } from '../airports/entities/airport.entity';
import { Flight } from '../flights/entities/flight.entity';
import { Order } from '../orders/entities/order.entity';
import { Passenger } from '../passengers/entities/passenger.entity';
import { User } from '../users/entities/user.entity';
import { AirplanesModule } from './airplanes.module';
import { S3Service } from '../shared/s3/s3.service';
import { FlightClasses } from '../flights/types/flight.classes';
import { FlightStatus } from '../flights/types/flight.status';
import { FlightCode } from '../flights/valueObjects/flight.code';
import { LuggageRules } from '../airlines/valueObjects/luggageRules';
import { CreateAirplaneDto } from './dto/create.airplane.dto';
import { AirportType } from '../airports/types/airport.type';

const UNKNOWN_ID = '00000000-0000-4000-8000-000000000000';

const buildAirplane = (id: string, brand: string, model: string): Airplane =>
  Object.assign(new Airplane(), {
    id,
    brand,
    model,
    passengersCapacity: 150,
    seatsConfig: [
      { class: FlightClasses.Economy, rowsQuantity: 25, columnsQuantity: 6 },
    ],
    imageUrl: '',
  });

describe('Airplanes endpoints', () => {
  let app: INestApplication<App>;
  let airplanes: Repository<Airplane>;
  let flights: Repository<Flight>;
  let airlines: Repository<Airline>;
  const s3Service = { deleteFile: jest.fn() };
  let origin: Airport;
  let destination: Airport;

  const airportData = (
    iataCode: string,
    latitude: number,
    longitude: number,
  ): DeepPartial<Airport> => ({
    iataCode,
    name: `${iataCode} airport`,
    countryCode: 'AR',
    countryName: 'Argentina',
    continent: 'SA',
    latitude,
    longitude,
    type: AirportType.Large,
  });

  const boeing = buildAirplane(
    '11111111-1111-4111-8111-111111111111',
    'Boeing',
    '737-800',
  );
  const airbus = buildAirplane(
    '22222222-2222-4222-8222-222222222222',
    'Airbus',
    'A320neo',
  );

  const saveFlightOf = async (
    airplane: Airplane,
    airline?: Airline,
  ): Promise<void> => {
    await flights.save({
      code: new FlightCode('AL', 1234),
      origin,
      destination,
      distance: 400,
      airplane,
      airline,
      departure: new Date('2026-12-01T10:00:00Z'),
      arrival: new Date('2026-12-01T11:30:00Z'),
      status: FlightStatus.Scheduled,
      seats: [],
      basePrice: 100,
    } as DeepPartial<Flight>);
  };

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [
            Airplane,
            Flight,
            Airline,
            Airport,
            Order,
            Passenger,
            User,
          ],
          synchronize: true,
        }),
        AirplanesModule,
      ],
    })
      .overrideProvider(S3Service)
      .useValue(s3Service)
      .compile();

    app = module.createNestApplication();
    // Same as main.ts, so the DTO's transforms and validations run
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    airplanes = module.get(getRepositoryToken(Airplane));
    flights = module.get(getRepositoryToken(Flight));
    airlines = module.get(DataSource).getRepository(Airline);

    const airports = module.get(DataSource).getRepository(Airport);
    [origin, destination] = await airports.save([
      airportData('EZE', -34.8222, -58.5358),
      airportData('COR', -31.3236, -64.208),
    ]);
  });

  beforeEach(async () => {
    s3Service.deleteFile.mockReset();
    await flights.clear();
    await airlines.clear();
    await airplanes.clear();
    await airplanes.save([boeing, airbus]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /airplanes lists airplanes ordered by brand and model', async () => {
    const response = await request(app.getHttpServer())
      .get('/airplanes')
      .expect(200);

    const body = response.body as Airplane[];
    expect(body.map(({ brand, model }) => `${brand} ${model}`)).toEqual([
      'Airbus A320neo',
      'Boeing 737-800',
    ]);
  });

  it('DELETE /airplanes/:id deletes the airplane and returns 204', async () => {
    await request(app.getHttpServer())
      .delete(`/airplanes/${airbus.id}`)
      .expect(204);

    expect(await airplanes.findOneBy({ id: airbus.id })).toBeNull();
    expect(await airplanes.count()).toBe(1);
    expect(s3Service.deleteFile).not.toHaveBeenCalled();
  });

  it('DELETE /airplanes/:id also deletes the airplane image', async () => {
    await airplanes.update(airbus.id, {
      imageUrl: 'https://bucket.s3.region.amazonaws.com/file_123',
    });

    await request(app.getHttpServer())
      .delete(`/airplanes/${airbus.id}`)
      .expect(204);

    expect(s3Service.deleteFile).toHaveBeenCalledWith('file_123');
  });

  it('DELETE /airplanes/:id returns 409 and keeps an airplane a flight uses', async () => {
    const airline = await airlines.save(
      Object.assign(new Airline(), {
        name: 'Alpha Air',
        code: 'AL',
        luggageRules: new LuggageRules(25, 2, 60, 15.5),
        flightClassPriceIncrements: [],
        redeemFee: 35,
      }),
    );
    await saveFlightOf(airbus, airline);

    const response = await request(app.getHttpServer())
      .delete(`/airplanes/${airbus.id}`)
      .expect(409);

    expect((response.body as { message: string }).message).toBe(
      `Airplane ${airbus.id} is used by 1 flight(s) of Alpha Air and cannot be deleted`,
    );
    expect(await airplanes.findOneBy({ id: airbus.id })).not.toBeNull();
  });

  it('DELETE /airplanes/:id returns 404 for an unknown id', async () => {
    await request(app.getHttpServer())
      .delete(`/airplanes/${UNKNOWN_ID}`)
      .expect(404);

    expect(await airplanes.count()).toBe(2);
  });

  it('DELETE /airplanes/:id returns 400 for an id that is not a UUID', async () => {
    await request(app.getHttpServer())
      .delete('/airplanes/not-a-uuid')
      .expect(400);
  });

  describe('POST /airplanes', () => {
    const body = (overrides: object = {}): CreateAirplaneDto =>
      ({
        id: '33333333-3333-4333-8333-333333333333',
        brand: 'Embraer',
        model: 'E190-E2',
        passengersCapacity: 105,
        seatsConfig: [
          { class: 'economy', rowsQuantity: 24, columnsQuantity: 4 },
          { class: 'business', rowsQuantity: 3, columnsQuantity: 3 },
        ],
        ...overrides,
      }) as CreateAirplaneDto;

    const post = (payload: object): request.Test =>
      request(app.getHttpServer()).post('/airplanes').send(payload);

    it('saves an airplane', async () => {
      await post(body()).expect(201);

      expect(await airplanes.count()).toBe(3);
    });

    it('stores the brand and model trimmed', async () => {
      await post(body({ brand: ' Embraer ', model: ' E190-E2 ' })).expect(201);

      const stored = await airplanes.findOneBy({ model: 'E190-E2' });
      expect(stored?.brand).toBe('Embraer');
    });

    it('returns 409 for a new airplane with a model already in use', async () => {
      const response = await post(body({ model: ' A320neo ' })).expect(409);

      expect((response.body as { message: string }).message).toBe(
        'An airplane with model A320neo already exists',
      );
      expect(await airplanes.count()).toBe(2);
    });

    it('lets an upsert keep the airplane its own model', async () => {
      await post(
        body({ id: airbus.id, brand: 'Airbus SE', model: 'A320neo' }),
      ).expect(201);

      const stored = await airplanes.findOneBy({ id: airbus.id });
      expect(stored?.brand).toBe('Airbus SE');
      expect(await airplanes.count()).toBe(2);
    });

    it('returns 409 when an upsert changes the model to one already in use', async () => {
      await post(body({ id: airbus.id, model: '737-800' })).expect(409);

      const stored = await airplanes.findOneBy({ id: airbus.id });
      expect(stored?.model).toBe('A320neo');
    });

    it.each([
      ['an id that is not a UUID', { id: 'not-a-uuid' }],
      ['an empty brand', { brand: '' }],
      ['no seat classes', { seatsConfig: [] }],
      [
        'an unknown class',
        {
          seatsConfig: [
            { class: 'firstClass', rowsQuantity: 2, columnsQuantity: 4 },
          ],
        },
      ],
      [
        'a repeated class',
        {
          seatsConfig: [
            { class: 'economy', rowsQuantity: 2, columnsQuantity: 4 },
            { class: 'economy', rowsQuantity: 3, columnsQuantity: 4 },
          ],
        },
      ],
      ['a capacity that differs from the seats', { passengersCapacity: 104 }],
      [
        'more than 100 rows',
        {
          passengersCapacity: 404,
          seatsConfig: [
            { class: 'economy', rowsQuantity: 101, columnsQuantity: 4 },
          ],
        },
      ],
      [
        'more than 26 columns',
        {
          seatsConfig: [
            { class: 'economy', rowsQuantity: 2, columnsQuantity: 27 },
          ],
        },
      ],
    ])('returns 400 for %s', async (_, overrides) => {
      await post(body(overrides)).expect(400);

      expect(await airplanes.count()).toBe(2);
    });
  });
});
