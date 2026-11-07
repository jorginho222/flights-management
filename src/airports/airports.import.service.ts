import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial } from 'typeorm';
import { Airport } from './entities/airport.entity';
import { OurAirportsAirportRow, OurAirportsClient } from './ourairports.client';
import { AirportType } from './types/airport.type';
import { AIRPORT_CODE_PATTERN } from './dto/airport.dto';

const KEPT_TYPES: string[] = [AirportType.Large, AirportType.Medium];
const UPSERT_CHUNK_SIZE = 500;

export type AirportsImportResult = {
  fetched: number;
  upserted: number;
};

@Injectable()
export class AirportsImportService {
  constructor(
    private readonly client: OurAirportsClient,
    private readonly dataSource: DataSource,
  ) {}

  // Upserts by IATA code, so it can be re-run and keeps the ids that flights
  // reference. Airports missing upstream are left in place.
  async import(): Promise<AirportsImportResult> {
    const [rows, countries] = await Promise.all([
      this.client.fetchAirports(),
      this.client.fetchCountries(),
    ]);
    const countryNames = new Map(countries.map((c) => [c.code, c.name]));
    const airports = this.selectAirports(rows, countryNames);

    await this.dataSource.transaction(async (manager) => {
      for (let i = 0; i < airports.length; i += UPSERT_CHUNK_SIZE) {
        await manager.upsert(
          Airport,
          airports.slice(i, i + UPSERT_CHUNK_SIZE),
          ['iataCode'],
        );
      }
    });

    return { fetched: rows.length, upserted: airports.length };
  }

  private selectAirports(
    rows: OurAirportsAirportRow[],
    countryNames: Map<string, string>,
  ): DeepPartial<Airport>[] {
    const byIataCode = new Map<string, DeepPartial<Airport>>();

    for (const row of rows) {
      const iataCode = row.iata_code?.trim().toUpperCase();
      if (!KEPT_TYPES.includes(row.type)) continue;
      if (!iataCode || !AIRPORT_CODE_PATTERN.test(iataCode)) continue;

      const airport = this.toAirport(row, iataCode, countryNames);
      const existing = byIataCode.get(iataCode);
      // A few codes appear twice; prefer the large airport
      if (!existing || airport.type === AirportType.Large) {
        byIataCode.set(iataCode, airport);
      }
    }

    return [...byIataCode.values()];
  }

  private toAirport(
    row: OurAirportsAirportRow,
    iataCode: string,
    countryNames: Map<string, string>,
  ): DeepPartial<Airport> {
    const elevation = parseInt(row.elevation_ft, 10);

    return {
      iataCode,
      icaoCode: row.icao_code?.trim() || null,
      name: row.name.trim(),
      city: row.municipality?.trim() || null,
      countryCode: row.iso_country,
      countryName: countryNames.get(row.iso_country) ?? row.iso_country,
      continent: row.continent,
      latitude: Number(row.latitude_deg),
      longitude: Number(row.longitude_deg),
      elevationFt: Number.isNaN(elevation) ? null : elevation,
      type: row.type as AirportType,
    };
  }
}
