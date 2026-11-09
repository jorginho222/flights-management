import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { Airport } from './entities/airport.entity';
import { AirportsModule } from './airports.module';
import { AirportType } from './types/airport.type';

let sequence = 0;
const buildAirport = (
  iataCode: string,
  name: string,
  city: string | null,
  countryCode = 'AR',
): Airport =>
  Object.assign(new Airport(), {
    id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
    iataCode,
    icaoCode: null,
    name,
    city,
    countryCode,
    countryName: countryCode === 'AR' ? 'Argentina' : 'United Kingdom',
    continent: countryCode === 'AR' ? 'SA' : 'EU',
    latitude: 0,
    longitude: 0,
    elevationFt: null,
    type: AirportType.Large,
  });

describe('GET /airports', () => {
  let app: INestApplication<App>;
  let repository: Repository<Airport>;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [Airport],
          synchronize: true,
        }),
        AirportsModule,
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
    repository = module.get(getRepositoryToken(Airport));
  });

  beforeEach(async () => {
    await repository.clear();
    await repository.save([
      // Contains "eze" in the middle of the name only
      buildAirport('AAA', 'Breezer Field', 'Somewhere'),
      // Starts with "eze" by city, but not by code
      buildAirport('BBB', 'Second Field', 'Ezeiza North'),
      buildAirport('EZE', 'Ministro Pistarini International Airport', 'Ezeiza'),
      buildAirport('LHR', 'London Heathrow Airport', 'London', 'GB'),
      buildAirport('LCY', 'London City Airport', 'London', 'GB'),
      // Its city starts with "lon", but its name doesn't
      buildAirport('LDB', 'Governor José Richa Airport', 'Londrina'),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  const codes = (body: unknown): string[] =>
    (body as Airport[]).map((airport) => airport.iataCode);

  it('ranks an exact IATA code, then code, name and city prefixes, then the rest', async () => {
    const response = await request(app.getHttpServer())
      .get('/airports')
      .query({ search: 'EZE' })
      .expect(200);

    expect(codes(response.body)).toEqual(['EZE', 'BBB', 'AAA']);
  });

  it('ranks a name prefix above a city prefix, ignoring case and spaces', async () => {
    const response = await request(app.getHttpServer())
      .get('/airports')
      .query({ search: '  lon ' })
      .expect(200);

    expect(codes(response.body)).toEqual(['LCY', 'LHR', 'LDB']);
  });

  it('treats LIKE wildcards as plain text', async () => {
    const response = await request(app.getHttpServer())
      .get('/airports')
      .query({ search: '%%%' })
      .expect(200);

    expect(response.body).toEqual([]);
  });

  it('filters by country and caps the results at limit', async () => {
    const response = await request(app.getHttpServer())
      .get('/airports')
      .query({ search: 'air', countryCode: 'gb', limit: 1 })
      .expect(200);

    expect(codes(response.body)).toEqual(['LCY']);
  });

  it('lists by IATA code without a search', async () => {
    const response = await request(app.getHttpServer())
      .get('/airports')
      .expect(200);

    expect(codes(response.body)).toEqual([
      'AAA',
      'BBB',
      'EZE',
      'LCY',
      'LDB',
      'LHR',
    ]);
  });

  it.each([[{ search: 'ez' }], [{ search: '  ez  ' }], [{ limit: 51 }]])(
    'rejects %j with 400',
    async (query) => {
      await request(app.getHttpServer())
        .get('/airports')
        .query(query)
        .expect(400);
    },
  );
});
