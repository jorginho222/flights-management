import { ConflictException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Flight } from './entities/flight.entity';
import { Airline } from '../airlines/entities/airline.entity';
import { Airport } from '../airports/entities/airport.entity';
import { FlightCode } from './valueObjects/flight.code';
import { isUniqueViolation } from '../shared/common/database.errors';

// Lookups and saving shared by flight creation and editing, run inside
// their transaction

export async function findAirport(
  manager: EntityManager,
  id: string,
): Promise<Airport> {
  const airport = await manager.findOne(Airport, { where: { id } });
  if (!airport) throw new NotFoundException(`Airport ${id} not found`);

  return airport;
}

// Locking the airline makes concurrent code generation for the same airline
// wait here, so two flights can't read the same last correlative. Take it
// after any flight lock, never before, so the lock order stays flight then
// airline.
export async function lockAirline(
  manager: EntityManager,
  id: string,
): Promise<Airline> {
  const airline = await manager.findOne(Airline, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!airline) throw new NotFoundException(`Airline ${id} not found`);

  return airline;
}

// The next code for a locked airline: its prefix and the highest correlative
// under that prefix plus one
export async function nextFlightCode(
  manager: EntityManager,
  airline: Airline,
): Promise<FlightCode> {
  const result = await manager
    .createQueryBuilder(Flight, 'flight')
    .select("MAX((flight.code ->> 'correlative')::int)", 'last')
    .where("flight.code ->> 'prefix' = :prefix", { prefix: airline.code })
    .getRawOne<{ last: number | null }>();

  return new FlightCode(airline.code, Number(result?.last ?? 0) + 1);
}

// The airline lock makes a clash rare, but a flight under another airline can
// hold the same prefix, e.g. after an airline code change
export async function saveWithFlightCode(
  manager: EntityManager,
  flight: Flight,
): Promise<Flight> {
  try {
    return await manager.save(flight);
  } catch (error) {
    if (isUniqueViolation(error, 'UQ_flight_code')) {
      throw new ConflictException(
        `Flight code ${flight.code.toString()} is already taken`,
      );
    }
    throw error;
  }
}
