import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { Airport } from './entities/airport.entity';
import { SearchAirportsDto } from './dto/search.airports.dto';

const DEFAULT_LIMIT = 20;

const escapeLike = (text: string): string => text.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class AirportsService {
  constructor(
    @InjectRepository(Airport)
    private readonly airportRepository: Repository<Airport>,
  ) {}

  /**
   * A text search matches any of the IATA code, name or city, ignoring case.
   * Results are ranked so the airport being typed comes first: an exact IATA
   * code, then a code, a name and a city starting with the text, then the rest.
   * LOWER() ... LIKE rather than ILIKE keeps it working on SQLite in specs.
   */
  async search({
    search,
    countryCode,
    limit,
  }: SearchAirportsDto): Promise<Airport[]> {
    const query = this.airportRepository
      .createQueryBuilder('airport')
      .limit(limit ?? DEFAULT_LIMIT);

    if (countryCode) {
      query.andWhere('airport.countryCode = :countryCode', { countryCode });
    }

    if (search) {
      const text = escapeLike(search.toLowerCase());
      query
        .andWhere(
          new Brackets((matches) =>
            ['iataCode', 'name', 'city'].forEach((column) =>
              matches.orWhere(
                `LOWER(airport.${column}) LIKE :contains ESCAPE '\\'`,
              ),
            ),
          ),
        )
        .addSelect(
          `CASE
            WHEN LOWER(airport.iataCode) = :exact THEN 0
            WHEN LOWER(airport.iataCode) LIKE :prefix ESCAPE '\\' THEN 1
            WHEN LOWER(airport.name) LIKE :prefix ESCAPE '\\' THEN 2
            WHEN LOWER(airport.city) LIKE :prefix ESCAPE '\\' THEN 3
            ELSE 4
          END`,
          'rank',
        )
        .setParameters({
          exact: search.toLowerCase(),
          prefix: `${text}%`,
          contains: `%${text}%`,
        })
        .orderBy('rank', 'ASC')
        .addOrderBy('airport.name', 'ASC');
    } else {
      query.orderBy('airport.iataCode', 'ASC');
    }

    return await query.getMany();
  }
}
