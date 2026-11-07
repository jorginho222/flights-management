import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AirportType } from '../types/airport.type';

// IATA airport codes, such as EZE or JFK
export const AIRPORT_CODE_PATTERN = /^[A-Z]{3}$/;

export const toUpperCase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class AirportDto {
  @ApiProperty({
    example: '3f1b6a52-6c1e-4c8e-9d36-1f2a3b4c5d6e',
    description: 'ID del aeropuerto. Formato UUID v4',
  })
  @IsUUID('4')
  id: string;

  @ApiProperty({
    example: 'EZE',
    description:
      'Código IATA del aeropuerto: 3 letras, se guarda en mayúsculas',
  })
  @Transform(toUpperCase)
  @Matches(AIRPORT_CODE_PATTERN)
  iataCode: string;

  @ApiPropertyOptional({ example: 'SAEZ', description: 'Código ICAO' })
  @IsOptional()
  @IsString()
  icaoCode?: string | null;

  @ApiProperty({
    example: 'Ministro Pistarini International Airport',
    description: 'Nombre del aeropuerto',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiPropertyOptional({ example: 'Ezeiza', description: 'Ciudad' })
  @IsOptional()
  @IsString()
  city?: string | null;

  @ApiProperty({ example: 'AR', description: 'Código ISO 3166-1 del país' })
  @Transform(toUpperCase)
  @Length(2, 2)
  countryCode: string;

  @ApiProperty({ example: 'Argentina', description: 'Nombre del país' })
  @IsString()
  @IsNotEmpty()
  countryName: string;

  @ApiProperty({ example: 'SA', description: 'Código del continente' })
  @Length(2, 2)
  continent: string;

  @ApiProperty({ example: -34.8222, description: 'Latitud en grados' })
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ example: -58.5358, description: 'Longitud en grados' })
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiPropertyOptional({ example: 67, description: 'Elevación en pies' })
  @IsOptional()
  @IsInt()
  elevationFt?: number | null;

  @ApiProperty({ enum: AirportType, example: AirportType.Large })
  @IsEnum(AirportType)
  type: AirportType;
}
