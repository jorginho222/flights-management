import { ApiProperty } from '@nestjs/swagger';
import { Flight } from '../entities/flight.entity';
import { PaginatedResult } from '../../shared/pagination/paginated.result';

// Concrete type so Swagger can describe the QUERY /flights response
export class PaginatedFlightsDto extends PaginatedResult<Flight> {
  @ApiProperty({ type: Flight, isArray: true })
  items: Flight[];
}
