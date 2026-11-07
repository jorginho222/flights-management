import { DataSource, DataSourceOptions } from 'typeorm';
import { Airplane } from './src/airplanes/entities/airplane.entity';
import { Flight } from './src/flights/entities/flight.entity';
import { Passenger } from './src/passengers/entities/passenger.entity';
import * as process from 'node:process';
import { Order } from './src/orders/entities/order.entity';
import { User } from './src/users/entities/user.entity';
import { Airline } from './src/airlines/entities/airline.entity';
import { Airport } from './src/airports/entities/airport.entity';
import * as dotenv from 'dotenv';

// Load .env.local, then .env (neither overrides existing azure production env vars)
dotenv.config({ path: ['.env.local', '.env'] });

const isDevelopment = process.env.ENVIRONMENT === 'development';
const ormConfigOptions: DataSourceOptions = {
  type: 'postgres',
  database: process.env.DB_NAME ?? 'flights_management',
  host: process.env.DB_HOST ?? 'localhost',
  port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
  username: process.env.DB_USER ?? 'postgres',
  password: process.env.DB_PASSWORD ?? 'postgres',
  entities: [Airplane, Flight, Passenger, Airline, Airport, Order, User],
  logging: true,
  synchronize: isDevelopment,
  ssl: isDevelopment ? false : { rejectUnauthorized: false },
  migrations: ['dist/src/migration/*.js'],
};

export const ormConfig = new DataSource(ormConfigOptions);
export { ormConfigOptions };
