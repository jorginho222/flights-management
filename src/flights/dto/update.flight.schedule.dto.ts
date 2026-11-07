import { IsDate, IsUUID } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateFlightScheduleDto {
  @ApiProperty({
    example: '1edf4131-fe1a-4f97-8a45-aa78d1531669',
    description: 'ID del vuelo. Formato UUID v4',
  })
  @IsUUID('4')
  id: string;

  @ApiProperty({
    example: '2025-06-04T21:07:31-03:00',
    description: 'Nueva fecha y hora de salida',
  })
  @IsDate()
  @Type(() => Date)
  departure: Date;

  @ApiProperty({
    example: '2025-06-04T23:07:31-03:00',
    description: 'Nueva fecha y hora de llegada',
  })
  @IsDate()
  @Type(() => Date)
  arrival: Date;
}
