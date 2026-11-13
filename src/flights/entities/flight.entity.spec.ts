import { Flight } from './flight.entity';
import { Airplane } from '../../airplanes/entities/airplane.entity';
import { Airline } from '../../airlines/entities/airline.entity';
import { FlightStatus } from '../types/flight.status';
import { FlightClasses } from '../types/flight.classes';
import { FlightCode } from '../valueObjects/flight.code';
import { FlightEditChanges } from '../types/flight.edit.changes';

describe('Flight', () => {
  const airplaneWith = (
    id: string,
    seatsConfig: Airplane['seatsConfig'],
  ): Airplane =>
    Object.assign(new Airplane(), { id, model: `Model ${id}`, seatsConfig });

  // 2 business seats, then 6 economy seats
  const currentAirplane = airplaneWith('current', [
    { class: FlightClasses.Business, rowsQuantity: 1, columnsQuantity: 2 },
    { class: FlightClasses.Economy, rowsQuantity: 2, columnsQuantity: 3 },
  ]);

  let flight: Flight;

  beforeEach(() => {
    flight = Object.assign(new Flight(), {
      code: new FlightCode('AL', 7),
      status: FlightStatus.Scheduled,
      airplane: currentAirplane,
      version: 3,
    });
    flight.setSeats();
  });

  const noChanges: FlightEditChanges = {
    route: false,
    airline: false,
    airplane: false,
    basePrice: false,
  };
  const only = (field: keyof FlightEditChanges): FlightEditChanges => ({
    ...noChanges,
    [field]: true,
  });
  const reserveFirstSeat = (): void => {
    flight.seats[0].passengerId = 'passenger-id';
  };

  describe('setSchedule', () => {
    const departure = new Date('2030-01-01T10:00:00Z');
    const arrival = new Date('2030-01-01T12:00:00Z');

    beforeEach(() => {
      flight.departure = departure;
      flight.arrival = arrival;
      flight.wasRescheduled = false;
    });

    it.each([
      ['a later departure', '2030-01-01T11:00:00Z', '2030-01-01T13:00:00Z'],
      ['an earlier departure', '2030-01-01T09:00:00Z', '2030-01-01T11:00:00Z'],
      ['only a new arrival', '2030-01-01T10:00:00Z', '2030-01-01T12:30:00Z'],
    ])(
      'marks the flight rescheduled for %s',
      (_case, newDeparture, newArrival) => {
        flight.setSchedule(new Date(newDeparture), new Date(newArrival));

        expect(flight.wasRescheduled).toBe(true);
        expect(flight.departure).toEqual(new Date(newDeparture));
        expect(flight.arrival).toEqual(new Date(newArrival));
      },
    );

    it('does not mark the flight rescheduled when the times are the same', () => {
      flight.setSchedule(new Date(departure), new Date(arrival));

      expect(flight.wasRescheduled).toBe(false);
    });

    it('keeps an earlier reschedule when the times are the same', () => {
      flight.wasRescheduled = true;

      flight.setSchedule(new Date(departure), new Date(arrival));

      expect(flight.wasRescheduled).toBe(true);
    });

    it('leaves the status unchanged', () => {
      flight.setSchedule(
        new Date('2030-01-01T11:00:00Z'),
        new Date('2030-01-01T13:00:00Z'),
      );

      expect(flight.status).toBe(FlightStatus.Scheduled);
    });

    it('does not mark the flight rescheduled when the schedule is invalid', () => {
      expect(() =>
        flight.setSchedule(
          new Date('2030-01-01T15:00:00Z'),
          new Date('2030-01-01T11:00:00Z'),
        ),
      ).toThrow('Departure must be before arrival');

      expect(flight.wasRescheduled).toBe(false);
    });
  });

  describe('assertEditable', () => {
    it('allows every change on a scheduled flight with no orders or reservations', () => {
      expect(() =>
        flight.assertEditable(
          { route: true, airline: true, airplane: true, basePrice: true },
          false,
          3,
        ),
      ).not.toThrow();
    });

    it.each([
      FlightStatus.GateChanged,
      FlightStatus.Cancelled,
      FlightStatus.Boarding,
    ])('rejects any edit while the flight is %s', (status) => {
      flight.status = status;

      expect(() => flight.assertEditable(only('basePrice'), false, 3)).toThrow(
        'AL7 can only be edited while scheduled, and it is ' + status,
      );
    });

    it.each(['route', 'airline'] as const)(
      'rejects a %s change when the flight has orders',
      (field) => {
        expect(() => flight.assertEditable(only(field), true, 3)).toThrow(
          'has orders, so its origin, destination and airline cannot change',
        );
      },
    );

    it.each(['airplane', 'basePrice'] as const)(
      'allows a %s change when the flight has orders',
      (field) => {
        expect(() => flight.assertEditable(only(field), true, 3)).not.toThrow();
      },
    );

    it.each(['route', 'airline', 'airplane'] as const)(
      'rejects a %s change when the flight has reserved seats',
      (field) => {
        reserveFirstSeat();

        expect(() => flight.assertEditable(only(field), false, 3)).toThrow(
          'has reserved seats, so only its base price can change',
        );
      },
    );

    it('allows a base price change when the flight has reserved seats', () => {
      reserveFirstSeat();

      expect(() =>
        flight.assertEditable(only('basePrice'), true, 3),
      ).not.toThrow();
    });

    it('rejects even a base price change when orders exist and the loaded version is out of date', () => {
      expect(() => flight.assertEditable(only('basePrice'), true, 2)).toThrow(
        'changed and has orders since it was loaded',
      );
    });

    it('allows only the base price when a reservation arrived after loading', () => {
      reserveFirstSeat();

      expect(() =>
        flight.assertEditable(only('basePrice'), false, 2),
      ).not.toThrow();
      expect(() => flight.assertEditable(only('airplane'), false, 2)).toThrow(
        'only its base price can change',
      );
    });

    it('applies the normal rules to an out of date version without orders or reservations', () => {
      expect(() =>
        flight.assertEditable(only('route'), false, 1),
      ).not.toThrow();
    });
  });

  describe('changeAirplane', () => {
    const biggerAirplane = airplaneWith('bigger', [
      { class: FlightClasses.Business, rowsQuantity: 2, columnsQuantity: 2 },
      { class: FlightClasses.Economy, rowsQuantity: 1, columnsQuantity: 4 },
    ]);

    it('rebuilds the seats from the new airplane', () => {
      flight.changeAirplane(biggerAirplane, new Map());

      expect(flight.airplane).toBe(biggerAirplane);
      expect(flight.seats).toHaveLength(8);
      expect(flight.seatsInClass(FlightClasses.Business)).toBe(4);
      expect(flight.seatsInClass(FlightClasses.Economy)).toBe(4);
      expect(flight.seats.every((seat) => seat.passengerId === null)).toBe(
        true,
      );
    });

    it('accepts orders that exactly fill a class', () => {
      expect(() =>
        flight.changeAirplane(
          biggerAirplane,
          new Map([[FlightClasses.Economy, 4]]),
        ),
      ).not.toThrow();
    });

    it('rejects an airplane with fewer seats than orders hold in a class, keeping the old seats', () => {
      const seatsBefore = flight.seats;

      expect(() =>
        flight.changeAirplane(
          biggerAirplane,
          new Map([[FlightClasses.Economy, 5]]),
        ),
      ).toThrow('Airplane Model bigger has 4 economy seats, but orders hold 5');
      expect(flight.airplane).toBe(currentAirplane);
      expect(flight.seats).toBe(seatsBefore);
    });

    it('rejects an airplane without a class that orders hold', () => {
      expect(() =>
        flight.changeAirplane(
          biggerAirplane,
          new Map([[FlightClasses.First, 1]]),
        ),
      ).toThrow('has 0 first seats, but orders hold 1');
    });

    it('refuses to rebuild seats that are reserved', () => {
      reserveFirstSeat();

      expect(() => flight.changeAirplane(biggerAirplane, new Map())).toThrow(
        'has reserved seats, so its airplane cannot change',
      );
    });
  });

  describe('changeAirline', () => {
    it('sets the airline and its new code', () => {
      const airline = Object.assign(new Airline(), { id: 'other', code: 'LA' });

      flight.changeAirline(airline, new FlightCode('LA', 12));

      expect(flight.airline).toBe(airline);
      expect(flight.code.toString()).toBe('LA12');
    });
  });

  describe('hasReservedSeats', () => {
    it('is false for seats that came back from JSON without a passenger', () => {
      flight.seats = flight.seats.map(({ class: c, column, row }) => ({
        class: c,
        column,
        row,
      })) as Flight['seats'];

      expect(flight.hasReservedSeats()).toBe(false);
    });
  });
});
