# Flights Management API

A REST API for an airline booking system, built with NestJS, TypeORM and PostgreSQL. It manages airlines, airplanes, flights, seat reservations, passengers and orders. The Angular frontend lives in a separate repository, `flights-management-front`, and is expected next to this one at `../flights-management-front`.

The project is in development and is not deployed anywhere. Some parts are still incomplete; see [Work in progress](#work-in-progress).

## Tech stack

- **NestJS 11** on Node.js, written in TypeScript
- **TypeORM** with **PostgreSQL** (SQLite in memory for some tests)
- **class-validator** and **class-transformer** for request validation
- **Swagger** API docs, served at `/docs`
- **@nestjs/event-emitter** for side effects between modules, and **@nestjs-modules/mailer** for emails
- **AWS S3** for airplane file uploads
- **Jest** and **supertest** for tests
- **Docker Compose** for local development

## Getting started

### Requirements

- Node.js 24 and npm (the Docker image uses Node 24)
- Docker with Docker Compose

### First run

```bash
cp .env.example .env    # then fill in the values you need, see Configuration
npm ci                  # install on the host first, see the note below
docker compose up -d    # starts the API, Postgres and Adminer
```

Run `npm ci` on the host **before** the first `docker compose up`. Otherwise Docker creates an empty `node_modules` owned by root as a mount point, and installs on the host fail with `EACCES`. To recover, stop the API, run `rmdir node_modules`, then run `npm ci`.

Once the containers are up:

| Service          | URL                             |
| ---------------- | ------------------------------- |
| API (hot reload) | http://localhost:3000           |
| Swagger UI       | http://localhost:3000/docs      |
| OpenAPI JSON     | http://localhost:3000/docs-json |
| Adminer (DB UI)  | http://localhost:8082           |
| Postgres         | `localhost:5433`                |

Postgres and Adminer use host ports 5433 and 8082 to avoid clashing with other local projects. Inside Compose, the database is still reachable at `db:5432`. The containers don't restart on their own, so start them again after a reboot.

### Working with the API container

The API container keeps its own `node_modules` in a named volume, separate from the host copy your IDE uses. After dependencies change, for example after a pull, update both:

```bash
npm ci
npm run docker:npm -- ci
```

### Loading airports

Flights reference airports, so fill the `airport` table before creating flights:

```bash
npm run airports:import
```

It downloads the public-domain [OurAirports](https://ourairports.com/data/) data and keeps the large and medium airports that have an IATA code, about 4,500. It runs from the host against `DB_PORT=5433`, and saves all airports or none. It upserts by IATA code, so you can run it again to refresh the data without changing the ids that flights reference. Airports removed upstream are not deleted.

Other helpers that run inside the container (it must be running):

```bash
npm run docker:install -- <package>   # npm install in the container
npm run docker:exec -- node -v        # run any command
npm run docker:shell                  # open a shell
npm run docker:logs                   # follow the API logs
```

## Configuration

Settings come from `.env`, with optional overrides in `.env.local`. Copy `.env.example`, which documents each variable.

| Variable                                                                            | Purpose                                                                                                                             |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `ENVIRONMENT`                                                                       | `development` uses TypeORM `synchronize` with no SSL. Any other value, or unset, turns SSL on and runs pending migrations at boot.  |
| `PORT`                                                                              | Port the API listens on (3000).                                                                                                     |
| `CORS_ORIGINS`                                                                      | Comma-separated origins allowed to call the API. Defaults to `http://localhost:4200`, the frontend.                                 |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`                                 | Credentials for the Postgres container.                                                                                             |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`                           | Database connection for commands run on the host (`DB_PORT=5433`). Compose sets these for the API container itself.                 |
| `AWS_S3_REGION`, `AWS_S3_BUCKET_NAME`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | S3 storage for airplane files. The region must not be blank or the API crashes at startup.                                          |
| `OURAIRPORTS_BASE_URL`                                                              | Optional. Where `npm run airports:import` downloads the CSVs from. Defaults to `https://davidmegginson.github.io/ourairports-data`. |
| `APPLICATION_INSIGHTS_CONNECTION_STRING`                                            | Optional. Leave empty to disable Application Insights.                                                                              |

## API overview

The full, interactive reference is the Swagger UI at `/docs`.

| Method   | Path                         | Description                              |
| -------- | ---------------------------- | ---------------------------------------- |
| `GET`    | `/airlines`                  | List airlines                            |
| `GET`    | `/airlines/:id`              | Get one airline                          |
| `POST`   | `/airlines`                  | Create or update an airline              |
| `POST`   | `/airlines/import`           | Import airlines from an .xlsx file       |
| `DELETE` | `/airlines/:id`              | Delete an airline                        |
| `GET`    | `/airports`                  | Search airports                          |
| `GET`    | `/airplanes`                 | List airplanes                           |
| `POST`   | `/airplanes`                 | Create or update an airplane             |
| `POST`   | `/airplanes/import`          | Import airplanes from an .xlsx file      |
| `PUT`    | `/airplanes/:id/upload-file` | Upload a file for an airplane to S3      |
| `PUT`    | `/airplanes/:id/delete-file` | Delete an airplane's file                |
| `DELETE` | `/airplanes/:id`             | Delete an airplane                       |
| `QUERY`  | `/flights`                   | Search flights, with a JSON body         |
| `GET`    | `/flights/events`            | Live flight updates (Server-Sent Events) |
| `POST`   | `/flights`                   | Create a flight                          |
| `PUT`    | `/flights/:flightId`         | Edit a scheduled flight                  |
| `PUT`    | `/flights/:flightId/reserve` | Reserve a seat                           |
| `PUT`    | `/flights/:flightId/cancel`  | Cancel a seat reservation                |
| `PATCH`  | `/flights/schedule`          | Change a flight's departure and arrival  |
| `PATCH`  | `/flights/status`            | Change a flight's status                 |
| `POST`   | `/passengers`                | Create a passenger                       |
| `POST`   | `/orders`                    | Create an order                          |

### Searching flights with `QUERY`

Flight search uses the HTTP `QUERY` method, which works like `GET` but takes a request body. There is no `GET /flights`. Send the filters as JSON. All are optional: `origin` and `destination` (airport IATA codes), `departureFrom`, `departureTo`, `status`, `airlineCode`, `page` and `limit` (20 by default).

```bash
curl -X QUERY http://localhost:3000/flights \
  -H 'Content-Type: application/json' \
  -d '{"origin": "EZE", "page": 1, "limit": 20}'
```

The response holds one page of flights in `items`, with their airline, airplane and airports, and the totals in `meta`:

```json
{
  "items": [{ "id": "…", "code": { "prefix": "LZ", "correlative": 1 } }],
  "meta": { "page": 1, "limit": 20, "totalItems": 45, "totalPages": 3 }
}
```

A page past the end returns an empty `items` list with the real totals.

The bundled Swagger UI can't display `QUERY` operations, so this endpoint is missing from `/docs`, though it is in `/docs-json`.

### Live flight updates

`GET /flights/events` is a [Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events) stream, so a browser can listen with `EventSource`. After a flight's status or schedule changes through `PATCH /flights/status` or `PATCH /flights/schedule`, it sends a `flight.updated` event with the fields a flight list shows:

```text
event: flight.updated
data: {"id":"…","status":"scheduled","departure":"2026-11-10T12:30:00.000Z","arrival":"2026-11-10T17:30:00.000Z","wasRescheduled":true,"version":6}
```

Use `version` to ignore an update older than the data you already have. The stream also sends a `ping` event every 30 seconds to keep the connection open. Try it with `curl -N http://localhost:3000/flights/events`.

Events are sent only after the change is committed. They are not stored, so a client that was disconnected misses them and should reload its data when it reconnects. The stream is kept in memory, so it only reaches clients connected to the same API process. Running more than one instance would need a shared channel such as Postgres `LISTEN/NOTIFY` or Redis. Other changes, such as `PUT /flights/:flightId`, reservations and orders, don't send events yet.

### Airports

`GET /airports` is a typeahead lookup, not a paged list. It takes optional query parameters: `search` (at least 3 characters, matched against the IATA code, name and city, ignoring case), `countryCode` and `limit` (default 20, at most 50). Search results are ranked: an exact IATA code first, then codes, names and cities that start with the text, then the other matches, each group by name. Without `search` the airports are listed by IATA code. When you create a flight, `origin` and `destination` are airport objects as this endpoint returns them. Only their `id` is used to load the stored airport.

### Spreadsheet imports

`POST /airlines/import` and `POST /airplanes/import` take an .xlsx file in the `file` form field. Columns are matched by their header, and every row is validated. The import saves all rows or none: if any row is invalid, the response lists the errors by row and column. Sample files are in `data/`.

## How it works

### Architecture

- **Business rules live on the entities**, and services orchestrate: they load entities, call methods on them and save. For example, `Flight.reserveSeat` and `Order.calculateTotal`.
- **Services are split by use case** rather than one per module. Flights has `FlightsUpsertService`, `FlightsUpdateService`, `FlightsSearchService` and `FlightsReserveService`.
- **Side effects use events.** For example, reserving a seat emits `flight.reserved`, and a subscriber in the passengers module emails the passenger. A status or schedule change emits `flight.updated`, which a subscriber in the flights module sends to the live updates stream.

### Flights and seats

- A flight's origin and destination are airports. Its `distance` is not sent by the client. It is the great-circle distance between the two airports' coordinates, in statute miles, rounded to a whole mile.
- When a flight is created, its seats are generated from the airplane's seat configuration (rows and columns per class) and stored as a JSON array on the flight.
- Reserving a seat sets the passenger on that seat and adds the passenger to the flight. The flight row is locked during the reservation, so two passengers can't take the same seat.
- Changing a flight's departure or arrival sets `wasRescheduled` to `true`. The status stays as it was, so a `scheduled` flight can still be edited.

### Editing a flight

`PUT /flights/:flightId` replaces a flight's origin, destination, airline, airplane and base price. Departure and arrival change through `PATCH /flights/schedule`, and status through `PATCH /flights/status`. Only fields that differ from the stored values count as changes, so the form can send every field back.

- Only a `scheduled` flight can be edited.
- **Orders:** once a flight has orders, its origin, destination and airline can't change. The airplane can, if the new one has enough seats in each class for what the orders hold.
- **Reserved seats:** once a seat is reserved, only the base price can change.
- **Airplane change:** the seats are rebuilt from the new airplane's seat configuration.
- **Airline change:** the flight gets a new code, the next number under the new airline's prefix.
- **`version`:** the body carries the flight's `version` as the form loaded it. Every save of the flight bumps it, and so does every order on it. If the flight has orders and the version is out of date, the edit is rejected, so it can't overwrite a flight that sold seats the form didn't see.

A broken rule returns `409 Conflict`, and a route with the same origin and destination returns `400`. The flight row is locked during the edit, and seat reservations and order creation lock it too, so the rules always see every committed order and reservation.

### Flight codes

Each flight gets a unique code made of the airline's two-character code and a correlative number, for example `AL1`, `AL2`. When a flight is created, or moved to another airline, the airline row is locked and the next number is the highest existing one for that prefix plus one. A unique index on the code backs this up, and a clash returns `409 Conflict`.

Changing an airline's own code doesn't change the codes of its existing flights. Only new flights and flights moved to that airline get the new prefix.

### Order pricing

An order's grand total combines:

- **Flights:** the flight's base price plus the airline's percentage increment for the chosen class, times the number of tickets.
- **Luggage:** charged per flight using the airline's luggage rules.
- **Miles redemption:** costs `distance × redeemed quantity` miles (distance in statute miles), plus the airline's redeem fee.

Money is stored as `numeric(12,2)` and rounded to 2 decimals.

### Order capacity

An order stores how many seats it takes on each of its flights. When an order is created, each flight is locked, and the order is rejected with `409 Conflict` if its class doesn't have enough seats left once existing orders are counted. Orders of every status count, because there is no cancelled status yet.

## Database and migrations

In development (`ENVIRONMENT=development`), TypeORM `synchronize` updates the schema from the entities, so schema changes work locally without a migration. Migrations still go in `src/migration/` and run against the local database:

```bash
npm run migration:generate -- src/migration/<Name>   # generate from entity changes
npm run migration:run                                # apply pending migrations
npm run migration:revert                             # undo the last one
```

Migrations load from `dist/src/migration/`. The API container's watch mode keeps `dist/` compiled, so run them while the container is up instead of building first.

New entities must be added to the `entities` array in `ormConfig.ts`.

## Testing

```bash
npm test                                    # all specs under src/
npm test -- src/flights/flights.upsert.service.spec.ts   # one file
npm test -- --testNamePattern="test name"   # tests matching a name
npm run test:watch
npm run test:cov
```

Running the whole suite in parallel can use a lot of memory, so add `--maxWorkers=1` if your machine struggles.

- **Unit specs** sit next to the code they test and mock repositories.
- **Co-located e2e specs** (`*.e2e.spec.ts`) start the module with an in-memory SQLite database and call it with supertest. `npm test` runs them; `npm run test:e2e` only runs the specs in `test/`.
- **Postgres-only behavior:** SQLite supports neither the row locks nor some of the Postgres SQL used when creating or editing a flight, reserving a seat or creating an order. The concurrency tests for these are listed as pending in `src/flights/flights.concurrency.e2e.spec.ts` until there is a Postgres test database.

## Project structure

```
src/
  airlines/     airlines, luggage rules, price increments, xlsx import
  airplanes/    airplanes, seat configuration, xlsx import, S3 files
  airports/     airports, OurAirports import command, distances
  flights/      flights, seats, codes, search and reservations
  orders/       orders and pricing
  passengers/   passengers and the event subscribers (emails, miles)
  users/        users, which are passengers with accumulated miles
  shared/       CORS, money helpers, database errors, S3, spreadsheet import
  migration/    TypeORM migrations
data/           sample .xlsx files for the imports
ormConfig.ts    database configuration, also used by the migration CLI
```

Each module uses `dto/`, `entities/`, `valueObjects/`, `types/`, `events/` and `subscribers/` as needed. File names are lowercase and dot-separated, such as `flights.reserve.service.ts`.

## Code quality

```bash
npm run lint      # ESLint, with auto-fix
npm run format    # Prettier
```

## Work in progress

- Cancelling and updating orders are not implemented yet.
- Some events are incomplete: nothing emits `order.paid`, and the miles and flight-cancelled subscribers are not registered.
- Cancelling a seat leaves the passenger on the flight.
- An order in a class the airline has no price increment for returns HTTP 500.
- There are no concurrency tests against Postgres yet.
- `wasRescheduled` doesn't say whether a flight was delayed or advanced, or keep earlier schedules. A rescheduling history is planned to replace it.

## Deployment

The app is not deployed. The repository still contains a GitHub Actions workflow for an Azure Web App, but it is not in use.
