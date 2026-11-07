import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';
import { AirportType } from '../types/airport.type';

// Assumed Earth radius in statute miles, the unit loyalty programs count
export const EARTH_RADIUS_MILES = 3958.8;

@Entity()
export class Airport {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column({ unique: true, length: 3 })
  readonly iataCode: string;

  @Column({ type: 'varchar', length: 4, nullable: true })
  icaoCode: string | null;

  @Column()
  name: string;

  @Column({ type: 'varchar', nullable: true })
  city: string | null;

  // ISO 3166-1 alpha-2
  @Column({ length: 2 })
  countryCode: string;

  @Column()
  countryName: string;

  @Column({ length: 2 })
  continent: string;

  @Column('double precision')
  latitude: number;

  @Column('double precision')
  longitude: number;

  @Column({ type: 'int', nullable: true })
  elevationFt: number | null;

  @Column({ type: 'varchar' })
  type: AirportType;

  // Great-circle (haversine) distance in statute miles, rounded to a whole mile
  distanceTo(other: Airport): number {
    const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
    const deltaLatitude = toRadians(other.latitude - this.latitude);
    const deltaLongitude = toRadians(other.longitude - this.longitude);

    const a =
      Math.sin(deltaLatitude / 2) ** 2 +
      Math.cos(toRadians(this.latitude)) *
        Math.cos(toRadians(other.latitude)) *
        Math.sin(deltaLongitude / 2) ** 2;
    const centralAngle = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return Math.round(EARTH_RADIUS_MILES * centralAngle);
  }
}
