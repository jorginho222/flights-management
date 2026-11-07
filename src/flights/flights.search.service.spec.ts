import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Between,
  FindManyOptions,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
} from 'typeorm';
import { Flight } from './entities/flight.entity';
import { FlightsSearchService } from './flights.search.service';
import { FlightStatus } from './types/flight.status';

describe('FlightsSearchService', () => {
  let service: FlightsSearchService;
  const findAndCount = jest.fn<
    Promise<[Flight[], number]>,
    [FindManyOptions<Flight>]
  >();

  const from = new Date('2026-12-01T00:00:00Z');
  const to = new Date('2026-12-08T00:00:00Z');

  beforeEach(async () => {
    findAndCount.mockReset();
    findAndCount.mockResolvedValue([[], 0]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsSearchService,
        { provide: getRepositoryToken(Flight), useValue: { findAndCount } },
      ],
    }).compile();

    service = module.get(FlightsSearchService);
  });

  const lastFindOptions = (): FindManyOptions<Flight> =>
    findAndCount.mock.calls[0][0];
  const lastWhere = (): FindOptionsWhere<Flight> =>
    lastFindOptions().where as FindOptionsWhere<Flight>;

  describe('searchFlights', () => {
    it('applies defaults when no filters are given', async () => {
      await service.searchFlights({});

      expect(findAndCount).toHaveBeenCalledWith({
        where: {},
        relations: { airline: true, origin: true, destination: true },
        order: { departure: 'ASC', id: 'ASC' },
        skip: 0,
        take: 20,
      });
    });

    it('filters by every provided field', async () => {
      await service.searchFlights({
        origin: 'JFK',
        destination: 'LHR',
        status: FlightStatus.Scheduled,
        airlineCode: 'AC',
      });

      expect(lastWhere()).toEqual({
        origin: { iataCode: 'JFK' },
        destination: { iataCode: 'LHR' },
        status: FlightStatus.Scheduled,
        airline: { code: 'AC' },
      });
    });

    it('uses Between when both departure bounds are given', async () => {
      await service.searchFlights({ departureFrom: from, departureTo: to });

      expect(lastWhere().departure).toEqual(Between(from, to));
    });

    it('uses an open range when only departureFrom is given', async () => {
      await service.searchFlights({ departureFrom: from });

      expect(lastWhere().departure).toEqual(MoreThanOrEqual(from));
    });

    it('uses an open range when only departureTo is given', async () => {
      await service.searchFlights({ departureTo: to });

      expect(lastWhere().departure).toEqual(LessThanOrEqual(to));
    });

    it('allows equal departure bounds', async () => {
      await service.searchFlights({ departureFrom: from, departureTo: from });

      expect(lastWhere().departure).toEqual(Between(from, from));
    });

    it('rejects a reversed departure range without querying', async () => {
      await expect(
        service.searchFlights({ departureFrom: to, departureTo: from }),
      ).rejects.toThrow(BadRequestException);

      expect(findAndCount).not.toHaveBeenCalled();
    });

    it('returns the page of flights with the pagination meta', async () => {
      const flights = [new Flight(), new Flight()];
      findAndCount.mockResolvedValue([flights, 45]);

      const result = await service.searchFlights({ page: 2 });

      expect(result.items).toBe(flights);
      expect(result.meta).toEqual({
        page: 2,
        limit: 20,
        totalItems: 45,
        totalPages: 3,
      });
    });

    it('returns no items but the real totals for a page past the end', async () => {
      findAndCount.mockResolvedValue([[], 3]);

      const result = await service.searchFlights({ page: 5, limit: 2 });

      expect(result.items).toEqual([]);
      expect(result.meta).toEqual({
        page: 5,
        limit: 2,
        totalItems: 3,
        totalPages: 2,
      });
    });

    it('converts page and limit to skip and take', async () => {
      await service.searchFlights({ page: 3, limit: 10 });

      expect(lastFindOptions()).toMatchObject({ skip: 20, take: 10 });
    });

    it('loads the airline and airports but never passengers or orders', async () => {
      await service.searchFlights({ origin: 'JFK' });

      expect(lastFindOptions().relations).toEqual({
        airline: true,
        origin: true,
        destination: true,
      });
    });
  });
});
