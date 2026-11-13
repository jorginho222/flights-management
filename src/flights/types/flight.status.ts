export enum FlightStatus {
  Scheduled = 'scheduled',
  Cancelled = 'cancelled',
  Departed = 'departed',
  InAir = 'inAir',
  Landed = 'landed',
  Arrived = 'arrived',
  Diverted = 'diverted',
  GateChanged = 'gateChanged',
  Boarding = 'boarding',
  FinalCall = 'finalCall',
  GateClosed = 'gateClosed',
  CheckInOpen = 'checkInOpen',
  CheckInClosed = 'checkInClosed',
  Unknown = 'unknown',
}

/**
 * The statuses of a flight that hasn't departed yet. Only these can become
 * delayed. Departed or later, cancelled and unknown flights keep their flag.
 */
export const PRE_DEPARTURE_STATUSES: ReadonlyArray<FlightStatus> = [
  FlightStatus.Scheduled,
  FlightStatus.CheckInOpen,
  FlightStatus.CheckInClosed,
  FlightStatus.GateChanged,
  FlightStatus.Boarding,
  FlightStatus.FinalCall,
  FlightStatus.GateClosed,
];
