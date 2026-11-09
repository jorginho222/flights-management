import { Flight } from '../entities/flight.entity';
import { FlightStatus } from '../types/flight.status';

export const FLIGHT_UPDATED = 'flight.updated';

/**
 * A flight's status or schedule changed. It carries the fields a flight list
 * shows, and the version so clients can drop stale or repeated updates.
 */
export class FlightUpdatedEvent {
  constructor(
    public readonly id: string,
    public readonly status: FlightStatus,
    public readonly departure: Date,
    public readonly arrival: Date,
    public readonly version: number,
  ) {}

  static fromFlight(flight: Flight): FlightUpdatedEvent {
    return new FlightUpdatedEvent(
      flight.id,
      flight.status,
      flight.departure,
      flight.arrival,
      flight.version,
    );
  }
}
