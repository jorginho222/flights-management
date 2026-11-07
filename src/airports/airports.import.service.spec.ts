import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AirportsImportService } from './airports.import.service';
import { Airport } from './entities/airport.entity';
import { OurAirportsAirportRow, OurAirportsClient } from './ourairports.client';
import { AirportType } from './types/airport.type';

const row = (
  overrides: Partial<OurAirportsAirportRow>,
): OurAirportsAirportRow => ({
  type: 'large_airport',
  name: 'Ministro Pistarini International Airport',
  latitude_deg: '-34.8222',
  longitude_deg: '-58.5358',
  elevation_ft: '67',
  continent: 'SA',
  iso_country: 'AR',
  municipality: 'Ezeiza',
  icao_code: 'SAEZ',
  iata_code: 'EZE',
  ...overrides,
});

describe('AirportsImportService', () => {
  let service: AirportsImportService;
  let fetchAirports: jest.Mock;
  let upsert: jest.Mock;
  let transaction: jest.Mock;

  beforeEach(async () => {
    fetchAirports = jest.fn();
    upsert = jest.fn().mockResolvedValue(undefined);
    transaction = jest.fn((work: (m: { upsert: jest.Mock }) => Promise<void>) =>
      work({ upsert }),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AirportsImportService,
        {
          provide: OurAirportsClient,
          useValue: {
            fetchAirports,
            fetchCountries: jest
              .fn()
              .mockResolvedValue([{ code: 'AR', name: 'Argentina' }]),
          },
        },
        { provide: DataSource, useValue: { transaction } },
      ],
    }).compile();

    service = module.get(AirportsImportService);
  });

  const upserted = (): Partial<Airport>[] =>
    upsert.mock.calls.flatMap(([, rows]) => rows as Partial<Airport>[]);

  it('maps a row to an airport with the country name', async () => {
    fetchAirports.mockResolvedValue([row({})]);

    await service.import();

    expect(upsert).toHaveBeenCalledWith(Airport, expect.any(Array), [
      'iataCode',
    ]);
    expect(upserted()).toEqual([
      {
        iataCode: 'EZE',
        icaoCode: 'SAEZ',
        name: 'Ministro Pistarini International Airport',
        city: 'Ezeiza',
        countryCode: 'AR',
        countryName: 'Argentina',
        continent: 'SA',
        latitude: -34.8222,
        longitude: -58.5358,
        elevationFt: 67,
        type: AirportType.Large,
      },
    ]);
  });

  it('keeps only large and medium airports with a valid IATA code', async () => {
    fetchAirports.mockResolvedValue([
      row({ iata_code: 'EZE' }),
      row({ iata_code: 'COR', type: 'medium_airport' }),
      row({ iata_code: 'AAA', type: 'small_airport' }),
      row({ iata_code: 'BBB', type: 'heliport' }),
      row({ iata_code: 'CCC', type: 'closed' }),
      row({ iata_code: '' }),
      row({ iata_code: '12' }),
    ]);

    const result = await service.import();

    expect(upserted().map((a) => a.iataCode)).toEqual(['EZE', 'COR']);
    expect(result).toEqual({ fetched: 7, upserted: 2 });
  });

  it('keeps one airport per IATA code, preferring the large one', async () => {
    fetchAirports.mockResolvedValue([
      row({ type: 'large_airport', name: 'Large' }),
      row({ type: 'medium_airport', name: 'Medium' }),
    ]);

    await service.import();

    expect(upserted()).toHaveLength(1);
    expect(upserted()[0].name).toBe('Large');
  });

  it('stores empty optional fields as null and falls back to the country code', async () => {
    fetchAirports.mockResolvedValue([
      row({
        icao_code: '',
        municipality: '',
        elevation_ft: '',
        iso_country: 'XK',
      }),
    ]);

    await service.import();

    expect(upserted()[0]).toMatchObject({
      icaoCode: null,
      city: null,
      elevationFt: null,
      countryName: 'XK',
    });
  });

  it('upserts in chunks of 500 inside one transaction', async () => {
    const codes = Array.from({ length: 1200 }, (_, i) =>
      String.fromCharCode(
        65 + Math.floor(i / 676),
        65 + (Math.floor(i / 26) % 26),
        65 + (i % 26),
      ),
    );
    fetchAirports.mockResolvedValue(
      codes.map((code) => row({ iata_code: code })),
    );

    await service.import();

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(
      upsert.mock.calls.map(([, rows]) => (rows as unknown[]).length),
    ).toEqual([500, 500, 200]);
  });
});
