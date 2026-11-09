import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Flight } from './entities/flight.entity';
import { Airplane } from '../airplanes/entities/airplane.entity';
import { Order } from '../orders/entities/order.entity';
import { UpdateFlightDto } from './dto/update.flight.dto';
import { FlightEditChanges } from './types/flight.edit.changes';
import {
  findAirport,
  lockAirline,
  nextFlightCode,
  saveWithFlightCode,
} from './flights.lookups';
import { roundMoney } from '../shared/common/money';

@Injectable()
export class FlightsUpdateService {
  constructor(private readonly dataSource: DataSource) {}

  // Edits a scheduled flight. The flight lock serializes the edit with seat
  // reservations and order creation, which lock the flight too, so the rules
  // see every committed order and reservation. The airline is locked after
  // the flight, the same order as everywhere else.
  async update(flightId: string, flightDto: UpdateFlightDto): Promise<Flight> {
    return await this.dataSource.transaction(async (manager) => {
      const flight = await this.loadLockedFlight(manager, flightId);
      const orders = await manager.find(Order, {
        where: { flights: { id: flightId } },
      });

      const changes = this.changesOf(flight, flightDto);
      this.applyRules(ConflictException, () =>
        flight.assertEditable(changes, orders.length > 0, flightDto.version),
      );

      if (changes.route) {
        const origin = await findAirport(manager, flightDto.origin.id);
        const destination = await findAirport(
          manager,
          flightDto.destination.id,
        );
        this.applyRules(BadRequestException, () =>
          flight.setRoute(origin, destination),
        );
      }

      if (changes.airplane) {
        const airplane = await this.findAirplane(
          manager,
          flightDto.airplane.id,
        );
        this.applyRules(ConflictException, () =>
          flight.changeAirplane(
            airplane,
            Order.soldSeatsByClass(orders, flightId),
          ),
        );
      }

      if (changes.airline) {
        const airline = await lockAirline(manager, flightDto.airline.id);
        flight.changeAirline(airline, await nextFlightCode(manager, airline));
      }

      flight.basePrice = roundMoney(flightDto.basePrice);

      return await saveWithFlightCode(manager, flight);
    });
  }

  // FOR UPDATE can't be applied to the outer joins that load relations, so
  // the flight is locked first and then read again with them
  private async loadLockedFlight(
    manager: EntityManager,
    flightId: string,
  ): Promise<Flight> {
    const locked = await manager.findOne(Flight, {
      where: { id: flightId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!locked) throw new NotFoundException(`Flight ${flightId} not found`);

    return (await manager.findOne(Flight, {
      where: { id: flightId },
      relations: ['origin', 'destination', 'airline', 'airplane'],
    })) as Flight;
  }

  // Only real changes count, so a form that sends every field back doesn't
  // trip the rules on fields it left as they were
  private changesOf(
    flight: Flight,
    flightDto: UpdateFlightDto,
  ): FlightEditChanges {
    return {
      route:
        flight.origin.id !== flightDto.origin.id ||
        flight.destination.id !== flightDto.destination.id,
      airline: flight.airline?.id !== flightDto.airline.id,
      airplane: flight.airplane?.id !== flightDto.airplane.id,
      basePrice: flight.basePrice !== roundMoney(flightDto.basePrice),
    };
  }

  private async findAirplane(
    manager: EntityManager,
    id: string,
  ): Promise<Airplane> {
    const airplane = await manager.findOne(Airplane, { where: { id } });
    if (!airplane) throw new NotFoundException(`Airplane ${id} not found`);

    return airplane;
  }

  // Flight throws plain Errors for its rules: a broken edit rule or capacity
  // is a conflict with the flight's state, an invalid route a bad request
  private applyRules(
    HttpError: typeof ConflictException | typeof BadRequestException,
    change: () => void,
  ): void {
    try {
      change();
    } catch (error) {
      throw new HttpError((error as Error).message);
    }
  }
}
