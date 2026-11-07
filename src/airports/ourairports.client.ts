import { Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

// Public-domain data, rebuilt daily: https://ourairports.com/data/
export const OURAIRPORTS_DEFAULT_BASE_URL =
  'https://davidmegginson.github.io/ourairports-data';

// The airports.csv columns the import reads
export type OurAirportsAirportRow = {
  type: string;
  name: string;
  latitude_deg: string;
  longitude_deg: string;
  elevation_ft: string;
  continent: string;
  iso_country: string;
  municipality: string;
  icao_code: string;
  iata_code: string;
};

// The countries.csv columns the import reads
export type OurAirportsCountryRow = {
  code: string;
  name: string;
};

@Injectable()
export class OurAirportsClient {
  private readonly baseUrl =
    process.env.OURAIRPORTS_BASE_URL || OURAIRPORTS_DEFAULT_BASE_URL;

  async fetchAirports(): Promise<OurAirportsAirportRow[]> {
    return await this.fetchCsv<OurAirportsAirportRow>('airports.csv');
  }

  async fetchCountries(): Promise<OurAirportsCountryRow[]> {
    return await this.fetchCsv<OurAirportsCountryRow>('countries.csv');
  }

  private async fetchCsv<T>(file: string): Promise<T[]> {
    const url = `${this.baseUrl}/${file}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`GET ${url} failed with HTTP ${response.status}`);
    }

    return parse(await response.text(), {
      columns: true,
      skip_empty_lines: true,
    });
  }
}
