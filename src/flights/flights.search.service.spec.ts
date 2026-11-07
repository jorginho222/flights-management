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
  const find = jest.fn<Promise<Flight[]>, [FindManyOptions<Flight>]>();

  const from = new Date('2026-12-01T00:00:00Z');
  const to = new Date('2026-12-08T00:00:00Z');

  beforeEach(async () => {
    find.mockReset();
    find.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightsSearchService,
        { provide: getRepositoryToken(Flight), useValue: { find } },
      ],
    }).compile();

    service = module.get(FlightsSearchService);
  });

  const lastFindOptions = (): FindManyOptions<Flight> => find.mock.calls[0][0];
  const lastWhere = (): FindOptionsWhere<Flight> =>
    lastFindOptions().where as FindOptionsWhere<Flight>;

  describe('searchFlights', () => {
    it('applies defaults when no filters are given', async () => {
      await service.searchFlights({});

      expect(find).toHaveBeenCalledWith({
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

      expect(find).not.toHaveBeenCalled();
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
