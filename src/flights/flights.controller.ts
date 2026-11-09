import {
  Body,
  Controller,
  Headers,
  HttpCode,
  MessageEvent,
  Param,
  Patch,
  Post,
  Put,
  QueryMethod,
  Sse,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { FlightsUpsertService } from './flights.upsert.service';
import { Flight } from './entities/flight.entity';
import { CreateFlightDto } from './dto/create.flight.dto';
import { UpdateFlightScheduleDto } from './dto/update.flight.schedule.dto';
import { FlightsSearchService } from './flights.search.service';
import { UpdateFlightStatusDto } from './dto/update.flight.status.dto';
import { AirplaneSeat } from './valueObjects/airplane.seat';
import { FlightsReserveService } from './flights.reserve.service';
import { SearchFlightsDto } from './dto/search.flights.dto';
import { PaginatedFlightsDto } from './dto/paginated.flights.dto';
import { PaginatedResult } from '../shared/pagination/paginated.result';
import { FlightsUpdateService } from './flights.update.service';
import { UpdateFlightDto } from './dto/update.flight.dto';
import { FlightUpdatesStream } from './subscribers/flight.updates.stream';

@Controller('flights')
export class FlightsController {
  constructor(
    private readonly flightsUpsertService: FlightsUpsertService,
    private readonly flightsSearchService: FlightsSearchService,
    private readonly flightsReserveService: FlightsReserveService,
    private readonly flightsUpdateService: FlightsUpdateService,
    private readonly flightUpdatesStream: FlightUpdatesStream,
  ) {}

  @Sse('events')
  @ApiOperation({
    summary: 'Live flight updates',
    description:
      'Server-Sent Events. Sends a `flight.updated` event with `id`, `status`, `departure`, `arrival` and `version` after a status or schedule change, and a `ping` every 30 seconds. Missed events are not replayed.',
  })
  @ApiProduces('text/event-stream')
  @ApiOkResponse({ description: 'An open event stream' })
  events(): Observable<MessageEvent> {
    return this.flightUpdatesStream.updates();
  }

  @QueryMethod()
  @ApiOkResponse({ type: PaginatedFlightsDto })
  async search(
    @Headers('content-type') contentType: string | undefined,
    @Body() searchDto: SearchFlightsDto,
  ): Promise<PaginatedResult<Flight>> {
    // The JSON body parser skips other types, which would look like "no filters"
    const mediaType = contentType?.split(';')[0].trim().toLowerCase();
    if (mediaType !== 'application/json') {
      throw new UnsupportedMediaTypeException(
        'QUERY /flights requires Content-Type: application/json',
      );
    }

    return await this.flightsSearchService.searchFlights(searchDto);
  }

  @Post()
  @HttpCode(201)
  async create(@Body() flightDto: CreateFlightDto) {
    return await this.flightsUpsertService.create(flightDto);
  }

  @Put('/:flightId/reserve')
  @HttpCode(200)
  async reserveFlightSeat(
    @Body() seat: AirplaneSeat,
    @Param('flightId') flightId: string,
  ) {
    return await this.flightsReserveService.reserveSeat(seat, flightId);
  }

  @Put('/:flightId/cancel')
  @HttpCode(200)
  async cancelFlightSeat(
    @Body() seat: AirplaneSeat,
    @Param('flightId') flightId: string,
  ) {
    return await this.flightsReserveService.cancelSeatReservation(
      seat,
      flightId,
    );
  }

  @Put('/:flightId')
  @HttpCode(200)
  async update(
    @Param('flightId') flightId: string,
    @Body() flightDto: UpdateFlightDto,
  ): Promise<Flight> {
    return await this.flightsUpdateService.update(flightId, flightDto);
  }

  @Patch('/schedule')
  @HttpCode(200)
  async updateSchedule(@Body() flightDto: UpdateFlightScheduleDto) {
    return await this.flightsUpsertService.updateSchedule(flightDto);
  }

  @Patch('/status')
  @HttpCode(200)
  async updateStatus(@Body() flightDto: UpdateFlightStatusDto) {
    return await this.flightsUpsertService.updateStatus(flightDto);
  }
}
