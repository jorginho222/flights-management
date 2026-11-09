import { CreateAirplaneDto } from '../../airplanes/dto/create.airplane.dto';
import { AirlineDto } from '../../airlines/dto/airline.dto';
import { AirportDto } from '../../airports/dto/airport.dto';
import {
  IsInt,
  IsNotEmpty,
  IsNumber,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Full replacement of a scheduled flight's editable fields. Departure and
// arrival change through PATCH /flights/schedule, status through
// PATCH /flights/status.
export class UpdateFlightDto {
  @ApiProperty({
    type: AirlineDto,
    description:
      'Aerolínea del vuelo. Si cambia, el vuelo recibe un código nuevo con el prefijo de la aerolínea',
  })
  @IsNotEmpty()
  airline: AirlineDto;

  @ApiProperty({
    type: CreateAirplaneDto,
    description:
      'Avión del vuelo. Si cambia, los asientos se regeneran a partir de su configuración',
  })
  @IsNotEmpty()
  airplane: CreateAirplaneDto;

  @ApiProperty({
    type: AirportDto,
    description: 'Aeropuerto de origen',
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AirportDto)
  origin: AirportDto;

  @ApiProperty({
    type: AirportDto,
    description:
      'Aeropuerto de destino. La distancia en millas se calcula a partir de los aeropuertos',
  })
  @IsNotEmpty()
  @ValidateNested()
  @Type(() => AirportDto)
  destination: AirportDto;

  @ApiProperty({
    example: 1000,
    description: 'Precio base del vuelo',
  })
  @IsNumber({ maxDecimalPlaces: 2 })
  basePrice: number;

  @ApiProperty({
    example: 3,
    description:
      'Versión del vuelo que cargó el formulario. Si el vuelo recibió órdenes desde entonces, la edición se rechaza con 409',
  })
  @IsInt()
  @Min(1)
  version: number;
}
