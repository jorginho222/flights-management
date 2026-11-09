// The seats an order takes on one of its flights. Stored in a JSON column, so
// it comes back from the database as a plain object.
export interface OrderFlightSelection {
  flightId: string;
  purchaseQuantity: number;
  redeemQuantity: number;
}
