import { IsEnum, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { FlightStatus } from '../types/flight.status';

export class UpdateFlightStatusDto {
  @ApiProperty({
    example: '1edf4131-fe1a-4f97-8a45-aa78d1531669',
    description: 'ID del vuelo. Formato UUID v4',
  })
  @IsUUID('4')
  id: string;

  @ApiProperty({
    enum: FlightStatus,
    example: FlightStatus.Boarding,
    description: 'Nuevo estado del vuelo',
  })
  @IsEnum(FlightStatus)
  status: FlightStatus;
}
