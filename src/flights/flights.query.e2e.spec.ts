import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { FlightsController } from './flights.controller';
import { FlightsReserveService } from './flights.reserve.service';
import { FlightsUpdateService } from './flights.update.service';
import { FlightsSearchService } from './flights.search.service';
import { FlightsUpsertService } from './flights.upsert.service';
import { FlightUpdatesStream } from './subscribers/flight.updates.stream';
import { SearchFlightsDto } from './dto/search.flights.dto';
import { FlightStatus } from './types/flight.status';
import { PaginatedResult } from '../shared/pagination/paginated.result';

describe('QUERY /flights', () => {
  let app: INestApplication<App>;
  const searchFlights = jest.fn<
    Promise<PaginatedResult<unknown>>,
    [SearchFlightsDto]
  >();

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [FlightsController],
      providers: [
        { provide: FlightsSearchService, useValue: { searchFlights } },
        { provide: FlightsUpsertService, useValue: {} },
        { provide: FlightsReserveService, useValue: {} },
        { provide: FlightsUpdateService, useValue: {} },
        { provide: FlightUpdatesStream, useValue: {} },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();
  });

  beforeEach(() => {
    searchFlights.mockReset();
    searchFlights.mockResolvedValue(PaginatedResult.of([], 0, 1, 20));
  });

  afterAll(async () => {
    await app.close();
  });

  // supertest's types only know .query as the query-string helper on a request,
  // but on the agent it is also the HTTP method, like .get and .post
  const query = (): request.Test =>
    (
      request(app.getHttpServer()) as unknown as {
        query(url: string): request.Test;
      }
    ).query('/flights');

  it('passes the transformed DTO to the service and returns 200', async () => {
    searchFlights.mockResolvedValue(
      PaginatedResult.of([{ id: 'flight-1' }], 6, 1, 5),
    );

    const response = await query()
      .send({
        origin: 'jfk',
        departureFrom: '2026-12-01T00:00:00Z',
        status: FlightStatus.Scheduled,
        limit: 5,
      })
      .expect(200);

    expect(response.body).toEqual({
      items: [{ id: 'flight-1' }],
      meta: { page: 1, limit: 5, totalItems: 6, totalPages: 2 },
    });
    const dto = searchFlights.mock.calls[0][0];
    expect(dto).toBeInstanceOf(SearchFlightsDto);
    expect(dto.origin).toBe('JFK');
    expect(dto.departureFrom).toEqual(new Date('2026-12-01T00:00:00Z'));
    expect(dto.limit).toBe(5);
  });

  it('accepts a charset on the content type', async () => {
    await query()
      .set('Content-Type', 'application/json; charset=utf-8')
      .send(JSON.stringify({ origin: 'JFK' }))
      .expect(200);

    expect(searchFlights).toHaveBeenCalled();
  });

  it('accepts an empty JSON object', async () => {
    await query().send({}).expect(200);

    expect(searchFlights).toHaveBeenCalled();
  });

  it.each([
    ['an unknown status', { status: 'nope' }],
    ['a limit above the maximum', { limit: 101 }],
    ['a page below the minimum', { page: 0 }],
    ['an invalid date', { departureFrom: 'not-a-date' }],
    ['a non-string filter', { origin: { $ne: 'x' } }],
    ['an origin that is not an IATA code', { origin: 'New York' }],
  ])('returns 400 for %s', async (_name, body) => {
    await query().send(body).expect(400);

    expect(searchFlights).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    await query()
      .set('Content-Type', 'application/json')
      .send('{"origin":')
      .expect(400);

    expect(searchFlights).not.toHaveBeenCalled();
  });

  it('returns 415 for a non-JSON content type', async () => {
    await query().set('Content-Type', 'text/plain').send('x').expect(415);

    expect(searchFlights).not.toHaveBeenCalled();
  });

  it('returns 415 when there is no body or content type', async () => {
    await query().expect(415);

    expect(searchFlights).not.toHaveBeenCalled();
  });

  it('no longer serves GET /flights', async () => {
    await request(app.getHttpServer())
      .get('/flights')
      .query({ criteria: '{}' })
      .expect(404);

    expect(searchFlights).not.toHaveBeenCalled();
  });
});
