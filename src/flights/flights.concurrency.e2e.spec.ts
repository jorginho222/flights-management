// Pending: these need a real Postgres test database. SQLite supports neither
// the pessimistic_write locks nor the ::int cast in the correlative query, and
// the unit specs only check, with mocks, that the locks are requested.
describe('Flights concurrency (Postgres)', () => {
  describe('FlightsUpsertService.create', () => {
    it.todo(
      'gives concurrent creations for the same airline consecutive codes with no duplicates',
    );

    it.todo(
      'returns 409 Conflict when another airline already holds the code with the same prefix',
    );
  });

  describe('FlightsReserveService.reserveSeat', () => {
    it.todo(
      'lets only one of two concurrent reservations of the same seat succeed',
    );

    it.todo(
      'keeps both concurrent reservations of different seats on the same flight',
    );
  });

  describe('FlightsUpsertService schedule and status updates', () => {
    it.todo(
      'does not overwrite a seat reserved while the status or schedule is updated',
    );
  });

  describe('FlightsUpdateService.update', () => {
    it.todo(
      'rejects an edit with the loaded version once an order commits while it waits for the flight lock',
    );

    it.todo(
      'only accepts a base price change once a seat reservation commits while it waits for the flight lock',
    );

    it.todo(
      'gives a flight moved to another airline a code that does not clash with a concurrent creation for that airline',
    );
  });

  describe('OrderUpsertService.create', () => {
    it.todo(
      'lets only one of two concurrent orders take the last seats of a class',
    );

    it.todo(
      'does not deadlock two concurrent orders that share flights in different order',
    );

    it.todo(
      'checks capacity against the new airplane when an airplane change commits first',
    );
  });
});
