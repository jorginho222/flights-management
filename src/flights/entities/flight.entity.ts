import {
  Column,
  Entity,
  Index,
  JoinTable,
  ManyToMany,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Airplane } from '../../airplanes/entities/airplane.entity';
import { Passenger } from '../../passengers/entities/passenger.entity';
import { FlightStatus } from '../types/flight.status';
import { FlightCode } from '../valueObjects/flight.code';
import { flightCodeTransformer } from '../transformers/flight.code.transformer';
import { AirplaneSeat } from '../valueObjects/airplane.seat';
import { BadRequestException } from '@nestjs/common';
import { Airline } from '../../airlines/entities/airline.entity';
import { Order } from '../../orders/entities/order.entity';
import { moneyColumn } from '../../shared/common/money';
import { Airport } from '../../airports/entities/airport.entity';

@Entity()
// Unique on the code's prefix and correlative. TypeORM can't declare an index
// on JSON fields, so the 1794000000000-flightCodeUnique migration creates it,
// and synchronize: false stops dev synchronize from dropping it.
@Index('UQ_flight_code', { synchronize: false })
export class Flight {
  @PrimaryGeneratedColumn('uuid')
  readonly id: string;

  @Column('json', { transformer: flightCodeTransformer })
  readonly code: FlightCode;

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

  setStatus(status: FlightStatus) {
    this.status = status;
  }

  setSchedule(departure: Date, arrival: Date) {
    const status =
      departure < this.departure ? FlightStatus.Advanced : FlightStatus.Delayed;

    this.setDeparture(departure);
    this.setArrival(arrival);
    this.validateSchedule();

    this.setStatus(status);
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

  setSeats() {
    const seatsConfig = this.airplane.seatsConfig;
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

    this.seats = seats;
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
