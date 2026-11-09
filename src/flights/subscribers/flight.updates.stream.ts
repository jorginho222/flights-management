import { Injectable, MessageEvent } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { interval, map, merge, Observable, Subject } from 'rxjs';
import {
  FLIGHT_UPDATED,
  FlightUpdatedEvent,
} from '../events/flight.updated.event';

/** Keeps idle connections from being closed by proxies along the way. */
export const PING_INTERVAL_MS = 30_000;

/**
 * Bridges flight events to the `GET /flights/events` SSE stream. The subject
 * lives in this process, so only clients connected to it get the updates.
 */
@Injectable()
export class FlightUpdatesStream {
  private readonly flightUpdates = new Subject<FlightUpdatedEvent>();

  @OnEvent(FLIGHT_UPDATED)
  handleFlightUpdated(event: FlightUpdatedEvent): void {
    this.flightUpdates.next(event);
  }

  updates(): Observable<MessageEvent> {
    return merge(
      this.flightUpdates.pipe(
        map((event): MessageEvent => ({ type: FLIGHT_UPDATED, data: event })),
      ),
      interval(PING_INTERVAL_MS).pipe(
        map((): MessageEvent => ({ type: 'ping', data: '' })),
      ),
    );
  }
}
