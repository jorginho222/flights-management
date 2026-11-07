import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { toUpperCase } from './airport.dto';

export class SearchAirportsDto {
  @ApiPropertyOptional({
    example: 'ezeiza',
    description: 'Texto a buscar en el código IATA, el nombre o la ciudad',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  search?: string;

  @ApiPropertyOptional({ example: 'AR', description: 'Código ISO del país' })
  @IsOptional()
  @Transform(toUpperCase)
  @Length(2, 2)
  countryCode?: string;

  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}
