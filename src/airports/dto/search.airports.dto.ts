import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { toUpperCase } from './airport.dto';

export const AIRPORT_SEARCH_MIN_LENGTH = 3;
export const AIRPORT_SEARCH_MAX_LIMIT = 50;

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

// A typeahead lookup, not a paged list: the client narrows by typing more
export class SearchAirportsDto {
  @ApiPropertyOptional({
    example: 'ezeiza',
    minLength: AIRPORT_SEARCH_MIN_LENGTH,
    description:
      'Texto a buscar en el código IATA, el nombre o la ciudad. Mínimo 3 caracteres',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(AIRPORT_SEARCH_MIN_LENGTH)
  search?: string;

  @ApiPropertyOptional({ example: 'AR', description: 'Código ISO del país' })
  @IsOptional()
  @Transform(toUpperCase)
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional({
    example: 20,
    default: 20,
    minimum: 1,
    maximum: AIRPORT_SEARCH_MAX_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(AIRPORT_SEARCH_MAX_LIMIT)
  limit?: number;
}
