import { MessageEvent } from '@nestjs/common';
import { Subscription } from 'rxjs';
import { FlightUpdatesStream, PING_INTERVAL_MS } from './flight.updates.stream';
import {
  FLIGHT_UPDATED,
  FlightUpdatedEvent,
} from '../events/flight.updated.event';
import { FlightStatus } from '../types/flight.status';

describe('FlightUpdatesStream', () => {
  let stream: FlightUpdatesStream;
  let received: MessageEvent[];
  let subscription: Subscription;

  const event = new FlightUpdatedEvent(
    'flight-id',
    FlightStatus.Scheduled,
    new Date('2030-01-01T11:00:00Z'),
    new Date('2030-01-01T13:00:00Z'),
    true,
    false,
    4,
  );

  beforeEach(() => {
    jest.useFakeTimers();
    stream = new FlightUpdatesStream();
    received = [];
    subscription = stream.updates().subscribe((message) => {
      received.push(message);
    });
  });

  afterEach(() => {
    subscription.unsubscribe();
    jest.useRealTimers();
  });

  it('sends a handled event to connected clients as flight.updated', () => {
    stream.handleFlightUpdated(event);

    expect(received).toEqual([{ type: FLIGHT_UPDATED, data: event }]);
  });

  it('sends each event to every connected client', () => {
    const other: MessageEvent[] = [];
    const otherSubscription = stream
      .updates()
      .subscribe((message) => other.push(message));

    stream.handleFlightUpdated(event);

    expect(received).toHaveLength(1);
    expect(other).toHaveLength(1);
    otherSubscription.unsubscribe();
  });

  it('does not replay events sent before a client connected', () => {
    stream.handleFlightUpdated(event);
    const late: MessageEvent[] = [];
    const lateSubscription = stream
      .updates()
      .subscribe((message) => late.push(message));

    expect(late).toEqual([]);
    lateSubscription.unsubscribe();
  });

  it('sends a ping on every interval', () => {
    jest.advanceTimersByTime(PING_INTERVAL_MS - 1);
    expect(received).toEqual([]);

    jest.advanceTimersByTime(1);
    expect(received).toEqual([{ type: 'ping', data: '' }]);

    jest.advanceTimersByTime(PING_INTERVAL_MS);
    expect(received).toHaveLength(2);
  });
});
