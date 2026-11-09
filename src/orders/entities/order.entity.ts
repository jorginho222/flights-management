import {
  Column,
  Entity,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  Relation,
} from 'typeorm';
import { Flight } from '../../flights/entities/flight.entity';
import { OrderLuggage } from '../valueObjects/order.luggage';
import { FlightClasses } from '../../flights/types/flight.classes';
import type { User } from '../../users/entities/user.entity';
import { FlightSelectionDto } from '../dto/flightSelectionDto';
import { CreateOrderDto } from '../dto/create.order.dto';
import { OrderStatus } from '../types/order.status';
import { BadRequestException } from '@nestjs/common';
import { moneyColumn, roundMoney } from '../../shared/common/money';
import { OrderFlightSelection } from '../valueObjects/order.flight.selection';

@Entity()
export class Order {
  redeemedQuantity: number;

  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column()
  number: string;

  @Column()
  status: OrderStatus;

  @ManyToMany(() => Flight, (flight) => flight.orders)
  flights: Array<Flight>;

  @Column('json')
  luggage: OrderLuggage;

  @Column()
  class: FlightClasses;

  // Referenced by name with a type-only import: importing User at runtime
  // closes the cycle passenger -> flight -> order -> user, and User extends
  // Passenger, so it would load before Passenger is defined.
  @ManyToOne('User')
  user: Relation<User>;

  @Column()
  passengersQuantity: number;

  // Seats taken on each flight, which passengersQuantity sums across flights
  @Column('json')
  flightSelections: OrderFlightSelection[];

  @Column()
  exchangedMiles: number = 0;

  @Column(moneyColumn)
  flightsTotal: number = 0;

  @Column(moneyColumn)
  luggageTotal: number = 0;

  @Column(moneyColumn)
  redeemFee: number = 0;

  @Column(moneyColumn)
  grandTotal: number = 0;

  // Seats sold on a flight per class, by every order regardless of status
  // (there is no cancelled status yet)
  static soldSeatsByClass(
    orders: Order[],
    flightId: string,
  ): Map<FlightClasses, number> {
    const sold = new Map<FlightClasses, number>();
    for (const order of orders) {
      const seats = order.seatsOn(flightId);
      if (seats > 0) {
        sold.set(order.class, (sold.get(order.class) ?? 0) + seats);
      }
    }

    return sold;
  }

  seatsOn(flightId: string): number {
    return this.flightSelections
      .filter((selection) => selection.flightId === flightId)
      .reduce(
        (total, selection) =>
          total + selection.purchaseQuantity + selection.redeemQuantity,
        0,
      );
  }

  public calculateTotal(orderDto: CreateOrderDto): void {
    const flightSelectionDtoArray = orderDto.flightSelection;
    this.exchangedMiles = 0;
    this.redeemedQuantity = 0;
    this.redeemFee = 0;
    this.redeemFlightsWithMiles(flightSelectionDtoArray);
    this.calculateFlightTotal(flightSelectionDtoArray);
    this.calculateLuggageTotal();

    this.grandTotal = roundMoney(
      this.flightsTotal + this.luggageTotal + this.redeemFee,
    );
  }

  private calculateFlightTotal(
    flightSelectionArray: FlightSelectionDto[],
  ): void {
    this.flightsTotal = 0;
    flightSelectionArray.forEach((flightSelection) => {
      if (flightSelection.purchaseQuantity === 0) {
        return;
      }

      const flight = this.flights.find(
        (flight) => flight.id === flightSelection.flightId,
      );
      if (!flight) {
        throw new Error('Flight not found');
      }
      const airline = flight.airline;
      const incrementPercentage = airline.flightClassPriceIncrements.find(
        (increment) => increment.class === this.class,
      );
      if (!incrementPercentage) {
        throw new Error('Increment not found');
      }
      const incrementAmount =
        (flight.basePrice * incrementPercentage.increment.getValue()) / 100;
      const ticketPrice = roundMoney(flight.basePrice + incrementAmount);
      this.flightsTotal = roundMoney(
        this.flightsTotal + ticketPrice * flightSelection.purchaseQuantity,
      );
    });
  }

  private calculateLuggageTotal(): void {
    this.luggageTotal = 0;
    this.flights.forEach((flight) => {
      let partialTotal = 0;

      const airlineLuggageRules = flight.airline.luggageRules;
      if (!airlineLuggageRules) {
        return;
      }

      if (
        this.luggage.handBaggageQuantity > airlineLuggageRules.maxHandBaggage
      ) {
        const excessHandBaggage =
          this.luggage.handBaggageQuantity - airlineLuggageRules.maxHandBaggage;
        const priceHandBaggage = airlineLuggageRules.priceHandBaggage || 0;
        partialTotal += excessHandBaggage * priceHandBaggage;
      }

      const checkedLuggageQuantity = this.luggage.checkedLuggageQuantity || 0;
      const priceCheckedLuggage = airlineLuggageRules.priceCheckedLuggage || 0;
      partialTotal += checkedLuggageQuantity * priceCheckedLuggage;

      if (this.luggage.isWeightExceeded) {
        const priceExceededWeight =
          airlineLuggageRules.priceExceededWeight || 0;
        partialTotal += priceExceededWeight;
      }

      this.luggageTotal = roundMoney(this.luggageTotal + partialTotal);
    });
  }

  private redeemFlightsWithMiles(
    flightSelectionDtoArray: FlightSelectionDto[],
  ): void {
    let availableMiles = this.user.accumulatedMiles;
    flightSelectionDtoArray.forEach((flightSelection) => {
      if (flightSelection.redeemQuantity === 0) {
        return;
      }
      const flight = this.flights.find(
        (flight) => flight.id === flightSelection.flightId,
      );
      if (!flight) {
        throw new Error('Flight not found');
      }

      const necessaryMiles = flight.distance * flightSelection.redeemQuantity;
      if (availableMiles < necessaryMiles) {
        throw new BadRequestException({
          message: 'Not enough miles',
        });
      }

      availableMiles -= necessaryMiles;
      this.exchangedMiles += necessaryMiles;
      this.redeemedQuantity += flightSelection.redeemQuantity;
      this.redeemFee = roundMoney(
        this.redeemFee +
          flightSelection.redeemQuantity * flight.airline.redeemFee,
      );
    });
  }
}
