import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Airport } from './entities/airport.entity';
import { AirportsService } from './airports.service';
import { AirportDto } from './dto/airport.dto';
import { SearchAirportsDto } from './dto/search.airports.dto';

@Controller('airports')
export class AirportsController {
  constructor(private readonly airportsService: AirportsService) {}

  @Get()
  @ApiOkResponse({ type: AirportDto, isArray: true })
  async search(@Query() searchDto: SearchAirportsDto): Promise<Airport[]> {
    return await this.airportsService.search(searchDto);
  }
}
