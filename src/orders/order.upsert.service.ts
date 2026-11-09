import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { Order } from './entities/order.entity';
import { Flight } from '../flights/entities/flight.entity';
import { User } from '../users/entities/user.entity';
import { CreateOrderDto } from './dto/create.order.dto';
import { OrderLuggage } from './valueObjects/order.luggage';
import { OrderFlightSelection } from './valueObjects/order.flight.selection';
import { OrderStatus } from './types/order.status';
import { FlightClasses } from '../flights/types/flight.classes';

@Injectable()
export class OrderUpsertService {
  constructor(private readonly dataSource: DataSource) {}

  async create(orderDto: CreateOrderDto): Promise<Order> {
    const flightSelections: OrderFlightSelection[] =
      orderDto.flightSelection.map(
        ({ flightId, purchaseQuantity, redeemQuantity }) => ({
          flightId,
          purchaseQuantity,
          redeemQuantity,
        }),
      );
    const flightIds = [...new Set(flightSelections.map((s) => s.flightId))];

    return await this.dataSource.transaction(async (manager) => {
      const flights = await this.loadLockedFlights(manager, flightIds);

      const user = await manager.findOne(User, {
        where: { id: orderDto.userId },
      });
      if (!user) {
        throw new NotFoundException(`User ${orderDto.userId} not found`);
      }

      const order = manager.create(Order, {
        id: orderDto.id,
        number: '1',
        status: OrderStatus.Created,
        flights,
        luggage: new OrderLuggage(
          orderDto.handBaggageQuantity,
          orderDto.checkedLuggageQuantity,
          false,
        ),
        class: orderDto.class,
        user,
        flightSelections,
        passengersQuantity: flightSelections.reduce(
          (total, s) => total + s.purchaseQuantity + s.redeemQuantity,
          0,
        ),
        luggageTotal: 0,
        flightsTotal: 0,
        redeemFee: 0,
        grandTotal: 0,
        exchangedMiles: 0,
        redeemedQuantity: 0,
      });

      for (const flight of flights) {
        await this.assertSeatsLeft(manager, flight, order);
      }

      order.calculateTotal(orderDto);
      const saved = await manager.save(order);

      // Saving the order doesn't save its flights, so bump their version
      // here: a flight edit loaded before this order must see it changed
      await manager.increment(Flight, { id: In(flightIds) }, 'version', 1);

      return saved;
    });
  }

  async update() {
    // TODO: Partially update entity (when user advance with the order)
  }

  // Locks the flights in id order, so two orders sharing flights can't
  // deadlock, and so a flight edit or seat reservation waits for the order.
  // FOR UPDATE can't be applied to the outer joins that load relations, so
  // the flights are read again afterwards.
  private async loadLockedFlights(
    manager: EntityManager,
    flightIds: string[],
  ): Promise<Flight[]> {
    for (const flightId of [...flightIds].sort()) {
      const locked = await manager.findOne(Flight, {
        where: { id: flightId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!locked) {
        throw new NotFoundException(`Flight ${flightId} not found`);
      }
    }

    return await manager.find(Flight, {
      where: { id: In(flightIds) },
      relations: ['airline'],
    });
  }

  private async assertSeatsLeft(
    manager: EntityManager,
    flight: Flight,
    order: Order,
  ): Promise<void> {
    const orders = await manager.find(Order, {
      where: { flights: { id: flight.id } },
    });
    const flightClass: FlightClasses = order.class;
    const sold =
      Order.soldSeatsByClass(orders, flight.id).get(flightClass) ?? 0;
    const left = flight.seatsInClass(flightClass) - sold;

    if (order.seatsOn(flight.id) > left) {
      throw new ConflictException(
        `Flight ${flight.code.toString()} has ${Math.max(left, 0)} ${flightClass} seats left`,
      );
    }
  }
}
