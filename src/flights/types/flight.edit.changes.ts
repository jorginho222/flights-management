// Which parts of a flight an edit changes, compared with the stored values
export interface FlightEditChanges {
  route: boolean;
  airline: boolean;
  airplane: boolean;
  basePrice: boolean;
}
