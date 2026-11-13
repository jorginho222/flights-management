import {
  Column,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
  VersionColumn,
} from 'typeorm';
import { Airplane } from '../../airplanes/entities/airplane.entity';
import { Passenger } from '../../passengers/entities/passenger.entity';
import { FlightStatus, PRE_DEPARTURE_STATUSES } from '../types/flight.status';
import { FlightCode } from '../valueObjects/flight.code';
import { flightCodeTransformer } from '../transformers/flight.code.transformer';
import { AirplaneSeat } from '../valueObjects/airplane.seat';
import { BadRequestException } from '@nestjs/common';
import { Airline } from '../../airlines/entities/airline.entity';
import { Order } from '../../orders/entities/order.entity';
import { moneyColumn } from '../../shared/common/money';
import { Airport } from '../../airports/entities/airport.entity';
import { FlightClasses } from '../types/flight.classes';
import { FlightEditChanges } from '../types/flight.edit.changes';

@Entity()
// Unique on the code's prefix and correlative. TypeORM can't declare an index
// on JSON fields, so the 1794000000000-flightCodeUnique migration creates it,
// and synchronize: false stops dev synchronize from dropping it.
@Index('UQ_flight_code', { synchronize: false })
export class Flight {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column('json', { transformer: flightCodeTransformer })
  code: FlightCode;

  @ManyToOne(() => Airport, { nullable: false })
  origin: Airport;

  @ManyToOne(() => Airport, { nullable: false })
  destination: Airport;

  // Great-circle distance between the airports in statute miles, set by setRoute
  @Column()
  distance: number;

  @ManyToOne(() => Airplane)
  airplane: Airplane;

  @ManyToOne(() => Airline)
  airline: Airline;

  @Column()
  departure: Date;

  @Column()
  arrival: Date;

  @ManyToMany(() => Passenger, (passenger) => passenger.flights)
  @JoinTable({
    name: 'flight_passengers',
    joinColumns: [{ name: 'flight_id' }],
    inverseJoinColumns: [{ name: 'passenger_id' }],
  })
  passengers: Array<Passenger>;

  @ManyToMany(() => Order, (order) => order.flights)
  @JoinTable({
    name: 'flight_order',
    joinColumns: [{ name: 'flight_id' }],
    inverseJoinColumns: [{ name: 'order_id' }],
  })
  orders: Array<Order>;

  @Column()
  status: FlightStatus;

  @Column('json')
  seats: Array<AirplaneSeat>;

  @Column(moneyColumn)
  basePrice: number;

  @Column({ default: false })
  isFullyReserved: boolean;

  @Column({ default: false })
  wasRescheduled: boolean;

  // Set while the flight is still on the ground past its departure plus the
  // tolerance. It stays once the flight departs or is cancelled, and clears
  // when a reschedule moves the departure ahead again.
  @Column({ default: false })
  isDelayed: boolean;

  // Bumped by every save of the flight, and by order creation, which doesn't
  // save it. The edit form sends the version it loaded, to tell whether
  // orders arrived meanwhile.
  @VersionColumn({ default: 1 })
  version: number;

  setStatus(status: FlightStatus) {
    this.status = status;
  }

  setSchedule(departure: Date, arrival: Date) {
    const changed =
      new Date(departure).getTime() !== new Date(this.departure).getTime() ||
      new Date(arrival).getTime() !== new Date(this.arrival).getTime();

    this.setDeparture(departure);
    this.setArrival(arrival);
    this.validateSchedule();

    if (changed) {
      this.wasRescheduled = true;
    }
  }

  // Only a flight that hasn't departed is checked, so a departed or cancelled
  // flight keeps its flag. Returns whether the flag changed.
  refreshDelay(now: Date, toleranceMinutes: number): boolean {
    if (!PRE_DEPARTURE_STATUSES.includes(this.status)) {
      return false;
    }

    const deadline =
      new Date(this.departure).getTime() + toleranceMinutes * 60_000;
    const isDelayed = now.getTime() > deadline;
    const changed = isDelayed !== this.isDelayed;
    this.isDelayed = isDelayed;
    return changed;
  }

  setDeparture(departure: Date) {
    this.departure = departure;
  }

  setArrival(arrival: Date) {
    this.arrival = arrival;
  }

  setRoute(origin: Airport, destination: Airport) {
    this.origin = origin;
    this.destination = destination;
    this.validateRoute();

    this.distance = origin.distanceTo(destination);
  }

  validate() {
    this.validateRoute();
    this.validateSchedule();
  }

  validateRoute() {
    if (this.origin.iataCode === this.destination.iataCode) {
      throw new Error('Origin and destination must be different');
    }
  }

  validateSchedule() {
    if (this.departure > this.arrival) {
      throw new Error('Departure must be before arrival');
    }
  }

  // Only a scheduled flight can be edited, and what is already sold or
  // reserved on it limits which fields can change. A loaded version that is
  // out of date means orders or reservations may have arrived unseen, so
  // with orders nothing changes.
  assertEditable(
    changes: FlightEditChanges,
    hasOrders: boolean,
    loadedVersion: number,
  ): void {
    if (this.status !== FlightStatus.Scheduled) {
      throw new Error(
        `Flight ${this.code.toString()} can only be edited while scheduled, and it is ${this.status}`,
      );
    }
    if (hasOrders && loadedVersion !== this.version) {
      throw new Error(
        `Flight ${this.code.toString()} changed and has orders since it was loaded, reload it and try again`,
      );
    }
    if (
      this.hasReservedSeats() &&
      (changes.route || changes.airline || changes.airplane)
    ) {
      throw new Error(
        `Flight ${this.code.toString()} has reserved seats, so only its base price can change`,
      );
    }
    if (hasOrders && (changes.route || changes.airline)) {
      throw new Error(
        `Flight ${this.code.toString()} has orders, so its origin, destination and airline cannot change`,
      );
    }
  }

  changeAirline(airline: Airline, code: FlightCode): void {
    this.airline = airline;
    this.code = code;
  }

  // Rebuilds the seats, so it must not run with reserved seats. The new
  // airplane must still seat what orders sold in each class.
  changeAirplane(
    airplane: Airplane,
    soldSeatsByClass: Map<FlightClasses, number>,
  ): void {
    if (this.hasReservedSeats()) {
      throw new Error(
        `Flight ${this.code.toString()} has reserved seats, so its airplane cannot change`,
      );
    }

    const seats = Flight.buildSeats(airplane);
    for (const [flightClass, sold] of soldSeatsByClass) {
      const available = Flight.countClassSeats(seats, flightClass);
      if (sold > available) {
        throw new Error(
          `Airplane ${airplane.model} has ${available} ${flightClass} seats, but orders hold ${sold}`,
        );
      }
    }

    this.airplane = airplane;
    this.seats = seats;
    this.isFullyReserved = false;
  }

  hasReservedSeats(): boolean {
    return this.seats.some((seat) => Boolean(seat.passengerId));
  }

  seatsInClass(flightClass: FlightClasses): number {
    return Flight.countClassSeats(this.seats, flightClass);
  }

  setSeats() {
    this.seats = Flight.buildSeats(this.airplane);
  }

  // AirplaneSeat.class is a plain string, filled from a FlightClasses value
  private static countClassSeats(
    seats: Array<AirplaneSeat>,
    flightClass: FlightClasses,
  ): number {
    return seats.filter((seat) => seat.class === (flightClass as string))
      .length;
  }

  private static buildSeats(airplane: Airplane): Array<AirplaneSeat> {
    const seatsConfig = airplane.seatsConfig;
    const seats: Array<AirplaneSeat> = [];
    let globalRow = 0;

    seatsConfig.forEach((seatConfig) => {
      for (let row = 1; row <= seatConfig.rowsQuantity; row++) {
        for (let column = 0; column < seatConfig.columnsQuantity; column++) {
          const seat: AirplaneSeat = {
            class: seatConfig.class,
            column: String.fromCharCode(97 + column), // generates letters from 'a' to 'z'
            row: globalRow,
            passengerId: null,
          };
          seats.push(seat);
        }

        globalRow++;
      }
    });

    return seats;
  }

  reserveSeat(seat: AirplaneSeat, passenger: Passenger) {
    const seatSearchResult = this.seats.findIndex(
      (s) => s.column === seat.column && s.row === seat.row,
    );

    if (seatSearchResult === -1) {
      throw new BadRequestException('Seat not found');
    }
    if (null !== this.seats[seatSearchResult].passengerId) {
      throw new BadRequestException('Seat already reserved');
    }

    this.seats[seatSearchResult].passengerId = seat.passengerId;

    this.checkFlightAvailability();

    this.passengers.push(passenger);
  }

  cancelSeatReservation(seat: AirplaneSeat) {
    const seatSearch = this.seats.find(
      (flightSeat) =>
        flightSeat.row === seat.row && flightSeat.column === seat.column,
    );
    if (!seatSearch) {
      throw new BadRequestException('Seat not found');
    }
    if (seatSearch.passengerId !== seat.passengerId) {
      throw new BadRequestException('Seat not reserved by passenger');
    }

    seatSearch.passengerId = null;
    this.isFullyReserved = false;
  }

  private checkFlightAvailability() {
    this.isFullyReserved = !this.seats.some((seat) => !seat.passengerId);
  }
}
