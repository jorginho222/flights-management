import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Between,
  FindOperator,
  FindOptionsWhere,
  LessThanOrEqual,
  MoreThanOrEqual,
  Repository,
} from 'typeorm';
import { Flight } from './entities/flight.entity';
import { SearchFlightsDto } from './dto/search.flights.dto';
import { PaginatedResult } from '../shared/pagination/paginated.result';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

@Injectable()
export class FlightsSearchService {
  constructor(
    @InjectRepository(Flight)
    private readonly flightRepository: Repository<Flight>,
  ) {}

  async searchFlights(
    searchDto: SearchFlightsDto,
  ): Promise<PaginatedResult<Flight>> {
    const page = searchDto.page ?? DEFAULT_PAGE;
    const limit = searchDto.limit ?? DEFAULT_LIMIT;

    // Every loaded relation is many-to-one, so the count and skip/take are exact
    const [flights, totalItems] = await this.flightRepository.findAndCount({
      where: this.buildSearchWhere(searchDto),
      relations: { airline: true, origin: true, destination: true },
      order: { departure: 'ASC', id: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return PaginatedResult.of(flights, totalItems, page, limit);
  }

  private buildSearchWhere(
    searchDto: SearchFlightsDto,
  ): FindOptionsWhere<Flight> {
    const { origin, destination, status, airlineCode } = searchDto;
    const where: FindOptionsWhere<Flight> = {};

    if (origin) where.origin = { iataCode: origin };
    if (destination) where.destination = { iataCode: destination };
    if (status) where.status = status;
    if (airlineCode) where.airline = { code: airlineCode };

    const departure = this.buildDepartureRange(searchDto);
    if (departure) where.departure = departure;

    return where;
  }

  private buildDepartureRange({
    departureFrom,
    departureTo,
  }: SearchFlightsDto): FindOperator<Date> | undefined {
    if (departureFrom && departureTo) {
      if (departureFrom > departureTo) {
        throw new BadRequestException(
          'departureFrom must not be after departureTo',
        );
      }
      return Between(departureFrom, departureTo);
    }
    if (departureFrom) return MoreThanOrEqual(departureFrom);
    if (departureTo) return LessThanOrEqual(departureTo);

    return undefined;
  }
}
