import { resolve } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken, TypeOrmModule } from '@nestjs/typeorm';
import { Workbook } from 'exceljs';
import * as request from 'supertest';
import { App } from 'supertest/types';
import { Repository } from 'typeorm';
import { Airplane } from './entities/airplane.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { Airport } from '../airports/entities/airport.entity';
import { Flight } from '../flights/entities/flight.entity';
import { Order } from '../orders/entities/order.entity';
import { Passenger } from '../passengers/entities/passenger.entity';
import { User } from '../users/entities/user.entity';
import { AirplanesModule } from './airplanes.module';
import { S3Service } from '../shared/s3/s3.service';

const SAMPLE_FILE = resolve(__dirname, '../../data/airplanes.import.xlsx');

const HEADERS = [
  'brand',
  'model',
  'passengersCapacity',
  'economyRows',
  'economyColumns',
  'premiumEconomyRows',
  'premiumEconomyColumns',
  'businessRows',
  'businessColumns',
  'firstRows',
  'firstColumns',
];

// 150 economy and 12 business seats, with no premium economy or first class
const validRow = (brand: string, model: string): unknown[] => [
  brand,
  model,
  162,
  25,
  6,
  null,
  null,
  3,
  4,
  null,
  null,
];

const buildFile = async (
  rows: unknown[][],
  headers: string[] = HEADERS,
): Promise<Buffer> => {
  const workbook = new Workbook();
  const sheet = workbook.addWorksheet('airplanes');
  sheet.addRow(headers);
  sheet.addRows(rows);

  return Buffer.from(await workbook.xlsx.writeBuffer());
};

describe('POST /airplanes/import', () => {
  let app: INestApplication<App>;
  let repository: Repository<Airplane>;

  const upload = (file: Buffer | string): request.Test =>
    request(app.getHttpServer())
      .post('/airplanes/import')
      .attach('file', file, 'airplanes.xlsx');

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'sqlite',
          database: ':memory:',
          entities: [
            Airplane,
            Flight,
            Airline,
            Airport,
            Order,
            Passenger,
            User,
          ],
          synchronize: true,
        }),
        AirplanesModule,
      ],
    })
      .overrideProvider(S3Service)
      .useValue({})
      .compile();

    app = module.createNestApplication();
    await app.init();
    repository = module.get(getRepositoryToken(Airplane));
  });

  beforeEach(async () => {
    await repository.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  it('imports the sample file', async () => {
    const response = await upload(SAMPLE_FILE).expect(201);

    expect(response.body).toEqual({ imported: 12 });
    expect(await repository.count()).toBe(12);
  });

  it('stores each column in the right place, skipping blank classes', async () => {
    await upload(await buildFile([validRow('Airbus', 'A320neo')])).expect(201);

    const [airplane] = await repository.find();

    expect(airplane.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(airplane).toMatchObject({
      brand: 'Airbus',
      model: 'A320neo',
      passengersCapacity: 162,
      imageUrl: '',
    });
    expect(airplane.seatsConfig).toEqual([
      { class: 'economy', rowsQuantity: 25, columnsQuantity: 6 },
      { class: 'business', rowsQuantity: 3, columnsQuantity: 4 },
    ]);
  });

  it('finds columns by header, whatever their order', async () => {
    const reversed = [...HEADERS].reverse();
    const row = [...validRow('Airbus', 'A320neo')].reverse();

    await upload(await buildFile([row], reversed)).expect(201);

    const [airplane] = await repository.find();
    expect(airplane.model).toBe('A320neo');
    expect(airplane.seatsConfig).toHaveLength(2);
  });

  it('reports every invalid cell by row and column and saves nothing', async () => {
    const noBrand = validRow('', 'A320neo');
    const badCapacity = validRow('Boeing', '737-800');
    badCapacity[2] = 10.5;
    const missingColumns = validRow('Embraer', 'E190');
    missingColumns[8] = null;
    const tooManyColumns = validRow('ATR', '72-600');
    tooManyColumns[4] = 27;
    const noClasses = validRow('Airbus', 'A350');
    noClasses[3] = noClasses[4] = noClasses[7] = noClasses[8] = null;
    const wrongCapacity = validRow('Boeing', '787-9');
    wrongCapacity[2] = 200;
    const tooManyRows = validRow('Airbus', 'A380');
    tooManyRows[3] = 101;

    const response = await upload(
      await buildFile([
        validRow('Airbus', 'A321neo'),
        noBrand,
        badCapacity,
        missingColumns,
        tooManyColumns,
        noClasses,
        wrongCapacity,
        tooManyRows,
      ]),
    ).expect(400);

    const body = response.body as {
      errors: { row: number; column: string }[];
    };
    expect(body.errors.map(({ row, column }) => [row, column])).toEqual([
      [3, 'brand'],
      [4, 'passengersCapacity'],
      [5, 'businessColumns'],
      [6, 'economyColumns'],
      [7, 'seatsConfig'],
      [8, 'passengersCapacity'],
      [9, 'economyRows'],
    ]);
    expect(await repository.count()).toBe(0);
  });

  it('rejects a model repeated in the file', async () => {
    const response = await upload(
      await buildFile([
        validRow('Airbus', 'A320neo'),
        validRow('Airbus', ' A320neo '),
      ]),
    ).expect(400);

    expect((response.body as { errors: unknown[] }).errors).toEqual([
      {
        row: 3,
        column: 'model',
        messages: ['model A320neo is already used in row 2'],
      },
    ]);
    expect(await repository.count()).toBe(0);
  });

  it('rejects a model that is already stored, so re-importing adds nothing', async () => {
    const file = await buildFile([validRow('Airbus', 'A320neo')]);
    await upload(file).expect(201);

    const response = await upload(file).expect(400);

    expect((response.body as { errors: unknown[] }).errors).toEqual([
      {
        row: 2,
        column: 'model',
        messages: ['an airplane with model A320neo already exists'],
      },
    ]);
    expect(await repository.count()).toBe(1);
  });

  it('explains a capacity that differs from the seats', async () => {
    const row = validRow('Boeing', '787-9');
    row[2] = 200;

    const response = await upload(await buildFile([row])).expect(400);

    expect(response.body).toMatchObject({
      errors: [
        {
          row: 2,
          column: 'passengersCapacity',
          messages: [
            'passengersCapacity must equal the 162 seats in seatsConfig',
          ],
        },
      ],
    });
  });

  it('rejects a file with missing columns', async () => {
    const headers = HEADERS.filter((header) => header !== 'firstColumns');

    const response = await upload(await buildFile([], headers)).expect(400);

    expect((response.body as { message: string }).message).toBe(
      'The file is missing these columns: firstColumns',
    );
  });

  it('rejects a file with no airplanes', async () => {
    const response = await upload(await buildFile([])).expect(400);

    expect((response.body as { message: string }).message).toBe(
      'The file has no airplanes to import',
    );
  });

  it('rejects a file that is not a workbook', async () => {
    await upload(Buffer.from('not a spreadsheet')).expect(400);
  });

  it('rejects a request with no file', async () => {
    await request(app.getHttpServer()).post('/airplanes/import').expect(400);
  });

  it('rejects a file over the size limit', async () => {
    await upload(Buffer.alloc(1024 * 1024 + 1)).expect(413);
  });
});
