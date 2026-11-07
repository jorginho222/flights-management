import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { FindOptionsWhere, ILike, Repository } from 'typeorm';
import { Airport } from './entities/airport.entity';
import { SearchAirportsDto } from './dto/search.airports.dto';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

@Injectable()
export class AirportsService {
  constructor(
    @InjectRepository(Airport)
    private readonly airportRepository: Repository<Airport>,
  ) {}

  async search(searchDto: SearchAirportsDto): Promise<Airport[]> {
    const page = searchDto.page ?? DEFAULT_PAGE;
    const limit = searchDto.limit ?? DEFAULT_LIMIT;

    return await this.airportRepository.find({
      where: this.buildSearchWhere(searchDto),
      order: { iataCode: 'ASC' },
      skip: (page - 1) * limit,
      take: limit,
    });
  }

  // A text search matches any of the IATA code, name or city
  private buildSearchWhere({
    search,
    countryCode,
  }: SearchAirportsDto): FindOptionsWhere<Airport>[] {
    const base: FindOptionsWhere<Airport> = countryCode ? { countryCode } : {};
    if (!search) return [base];

    const pattern = ILike(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
    return [
      { ...base, iataCode: pattern },
      { ...base, name: pattern },
      { ...base, city: pattern },
    ];
  }
}
