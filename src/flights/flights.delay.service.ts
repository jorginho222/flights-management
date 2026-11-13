import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DataSource, In, LessThan, Repository } from 'typeorm';
import { Flight } from './entities/flight.entity';
import { PRE_DEPARTURE_STATUSES } from './types/flight.status';
import { DELAY_TOLERANCE_MINUTES } from './flight.delay.tolerance';
import {
  FLIGHT_UPDATED,
  FlightUpdatedEvent,
} from './events/flight.updated.event';

/**
 * Marks flights delayed once they are still on the ground past their departure
 * plus the tolerance. Nothing else notices time passing, so it runs every minute.
 */
@Injectable()
export class FlightsDelayService {
  private readonly logger = new Logger(FlightsDelayService.name);

  constructor(
    @InjectRepository(Flight)
    private readonly flightRepository: Repository<Flight>,
    private readonly dataSource: DataSource,
    private readonly eventEmitter: EventEmitter2,
    @Inject(DELAY_TOLERANCE_MINUTES)
    private readonly toleranceMinutes: number,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'flight-delays' })
  async handleCron(): Promise<void> {
    await this.markDelayedFlights(new Date());
  }

  /** Returns the flights it marked. One failing flight doesn't stop the others. */
  async markDelayedFlights(now: Date): Promise<Flight[]> {
    const deadline = new Date(now.getTime() - this.toleranceMinutes * 60_000);
    const overdue = await this.flightRepository.find({
      select: { id: true },
      where: {
        status: In([...PRE_DEPARTURE_STATUSES]),
        isDelayed: false,
        departure: LessThan(deadline),
      },
      order: { id: 'ASC' },
    });

    const marked: Flight[] = [];
    for (const { id } of overdue) {
      try {
        const flight = await this.markDelayed(id, now);
        if (flight) {
          marked.push(flight);
          // After the commit, so a rollback never reaches clients
          this.eventEmitter.emit(
            FLIGHT_UPDATED,
            FlightUpdatedEvent.fromFlight(flight),
          );
        }
      } catch (error) {
        this.logger.error(
          `Could not mark flight ${id} delayed`,
          (error as Error).stack,
        );
      }
    }
    return marked;
  }

  // One short transaction per flight, so the lock is held only while it changes.
  // Saving bumps the version, which lets clients tell the update is newer.
  private async markDelayed(id: string, now: Date): Promise<Flight | null> {
    return await this.dataSource.transaction(async (manager) => {
      const flight = await manager.findOne(Flight, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      // It may have been rescheduled, departed or cancelled since the search
      if (!flight || !flight.refreshDelay(now, this.toleranceMinutes)) {
        return null;
      }
      return await manager.save(flight);
    });
  }
}
