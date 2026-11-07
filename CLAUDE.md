# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

NestJS and TypeORM airline booking API with modules for flights, airplanes, passengers, orders, airlines and users.

## Commands

```bash
npm run build                                  # Compile to dist/
npm run lint                                   # ESLint, with auto-fix
npm run format                                 # Prettier
npm run start:dev                              # Start with hot reload
npm run start:debug                            # Start in debug mode with watch
npm run test                                   # All tests under src/
npm run test -- src/app.controller.spec.ts     # Single test file
npm run test -- --testNamePattern="test name"  # Tests matching a name
npm run test:watch                             # Watch mode
npm run test:cov                               # Coverage report
npm run test:e2e                               # Tests under test/ only (see Testing)
npm run test:debug                             # Debug tests with the Node inspector
npm run airports:import                        # Download OurAirports data and upsert the airport table
```

**Do not run `npm run build`.** Run `npm run migration:run` on its own instead (see Migrations).

## Conventions

- **File names:** dot-separated and lowercase (`flights.reserve.service.ts`, `create.flight.dto.ts`), with kebab-case module directories.
- **Module layout:** `dto/`, `entities/`, `valueObjects/`, `types/`, `events/` and `subscribers/` as needed, with specs next to the source they cover.
- **Import order:** external packages, then entities, then services, DTOs and value objects.
- **Errors:** use NestJS HTTP exceptions (`BadRequestException`, `NotFoundException`, etc.) for HTTP errors, and plain `Error` for domain validation in entities and value objects.
- **Entities:** use UUID primary keys, `readonly` for fields that must not change after creation, and validation methods on the entity class. `User` extends `Passenger`, so an entity that `Passenger` loads, directly or through other entities, must not import `User` at runtime. `Order` references it by name (`@ManyToOne('User')`) with `import type` and `Relation<User>`.
- **DTOs:** validate with class-validator and parse with class-transformer, using separate DTOs for create, update and response.
- **TypeScript:** only `strictNullChecks` is on, not full strict mode, and `noImplicitAny` is off. Avoid `any` anyway, and give public methods explicit return types.
- **README:** `README.md` is the project documentation for people new to the repo. When a change affects something it describes, update it in the same change. That includes endpoints, setup, configuration variables, commands, domain rules such as pricing or flight codes, testing and the work-in-progress list.

## Local setup and database

- `docker compose up -d` starts the API (3000, hot reload), Postgres (host port 5433) and Adminer (8082). The host ports for Postgres and Adminer avoid clashes with other local projects. Inside Compose, Postgres is still `db:5432`, so tools running on the host need `DB_PORT=5433`. No containers restart on their own, so start them manually after a reboot.
- The `docker:*` npm scripts run from the host and act on the API container, which must be running: `npm run docker:install -- lodash`, `npm run docker:npm -- ci`, `npm run docker:exec -- node -v`, `npm run docker:shell`. Anything after `--` goes to the command in the container.
- The API container uses its own `node_modules` in the `api_node_modules` named volume, and a rebuild does not update it. The host needs a separate copy for the IDE, so after dependencies change, such as after a pull, run both `npm ci` and `npm run docker:npm -- ci`.
- On a fresh clone, run `npm ci` on the host before the first `docker compose up`. Otherwise Docker creates an empty root-owned `node_modules` as its mount point, and host installs fail with `EACCES`. To recover, stop the API, `rmdir node_modules`, then run `npm ci`.
- Compose reads `POSTGRES_DB`, `POSTGRES_USER` and `POSTGRES_PASSWORD` from `.env` or the shell, defaulting to `flights_management` / `postgres` / `postgres`. It sets the API's `DB_*` variables from them, with `DB_HOST=db` and `ENVIRONMENT=development`.
- The `Dockerfile` has `dev` and `prod` targets. Compose uses `dev`. Build the other with `docker build --target prod .`; it runs `node dist/src/main`.
- Compose mounts the whole project into the API, so files the container writes, including `dist/`, appear on the host. The image's `node` user is UID 1000, so a host user with a different UID may hit permission errors.
- App config comes from `.env` (gitignored; copy it from `.env.example`), with optional overrides in `.env.local`. `ormConfig.ts` loads both with dotenv, and `ConfigModule` loads them again for injected config such as `AWS_S3_*`. Variables set in Compose's `environment` block take priority over both files.
- `ENVIRONMENT=development` controls the database mode:
  - **Development:** TypeORM `synchronize: true`, no SSL, and migrations don't run at boot (run them with `npm run migration:run`).
  - **Anything else, including unset:** no synchronize, SSL on, and `main.ts` runs pending migrations at boot.
- CORS only allows the origins in `CORS_ORIGINS` (comma-separated, defaulting to `http://localhost:4200`, the frontend in `../flights-management-front`). The parsing and method list live in `src/shared/common/cors.ts`. A new HTTP method must be added to `CORS_METHODS`, or browsers will block it at preflight.
- Swagger UI is served at `/docs`. The bundled UI doesn't render HTTP `QUERY` operations, so `QUERY /flights` is missing from the page, though it is in the `/docs-json` document.

## Migrations

```bash
npm run migration:run                      # runs from the host against the local database (DB_PORT=5433)
npm run migration:generate -- src/migration/<Name>
npm run migration:revert
```

The app is not deployed to production, and the migrations run against the local database. They load from `dist/src/migration/*.js`, which the API container's watch mode keeps compiled because Compose mounts the project, so run `migration:run` without building. Make sure the API container is running and has picked up the new migration file first.

The local database was built by `synchronize`, so on 2026-11-06 its `migrations` table was created by hand with the migrations up to `AirplaneModelUnique1793995200000` marked as applied. Later migrations ran through `migration:run`. A fresh database would replay every migration from `InitialSchema`.

Because development relies on `synchronize`, a schema change on an entity works locally without a migration, but still generate one in `src/migration/` whenever an entity changes. Anything `synchronize` can't create needs a hand-written migration and a `synchronize: false` declaration on the entity, so synchronize doesn't drop it. An example is the `UQ_flight_code` expression index on the prefix and correlative inside `Flight.code`. New entities must also be added to the `entities` array in `ormConfig.ts`, which lists them explicitly with no glob.

## Build output

`ormConfig.ts` and `mailer.config.ts` sit at the repo root and are imported from `src/`, so compiled code lands in `dist/src/` rather than `dist/`. `migrations` in `ormConfig.ts` depends on this layout.

## Testing

- Unit tests use the `@nestjs/testing` `Test` module, with repositories mocked through `getRepositoryToken`.
- `npm test` matches every `src/**/*.spec.ts`, which includes the `*.e2e.spec.ts` files co-located with their modules.
- `npm run test:e2e` only matches `test/*.e2e-spec.ts`, so it does not run those co-located specs.
- Co-located e2e specs that need a database configure their own in-memory SQLite in `TypeOrmModule.forRoot`. `ormConfigTest.ts` is no longer used: `passengers.e2e.spec.ts` only imports it in commented-out code. `Flight` has relations to `Airline` and `Order`, so specs that load `Flight` must register those entities too.
- SQLite can't run `FlightsUpsertService.create` or `FlightsReserveService`. Both lock rows with `pessimistic_write`, and `create` also uses a Postgres `::int` cast, so tests that really create a flight or reserve a seat need Postgres.

## Architecture

**Domain logic sits on entities; services orchestrate.** Services load entities, call methods on them, and save. Examples are `Flight.reserveSeat` / `setSeats` and `Order.calculateTotal`. Put business rules on the entity.

**Services are split by use case, not per module.** Flights has `FlightsUpsertService`, `FlightsSearchService` and `FlightsReserveService`. Orders follows the same pattern with `OrderUpsertService` and `OrderCancelService`.

**Value objects are stored as JSON columns:**

- `Flight.code` is unique through the `UQ_flight_code` index. `FlightsUpsertService.create` locks the airline row and takes the highest correlative for the prefix plus one, and a clash with the index returns 409 Conflict.
- `Flight.seats` is a JSON array of `AirplaneSeat`, generated from `Airplane.seatsConfig` by `Flight.setSeats()`. A reservation sets `passengerId` on a seat in that array and also adds to the `flight_passengers` relation, so the two must stay in sync.
- `Airline.luggageRules` and `flightClassPriceIncrements` use custom transformers in `src/airlines/transformers/` to rebuild class instances. `Flight.code` does the same with `flightCodeTransformer` in `src/flights/transformers/`, which stores a plain object rather than a JSON string. Other JSON columns, such as `Flight.seats` and `Order.luggage`, come back from the database as plain objects with no methods.

**Order pricing** (`Order.calculateTotal`) combines three parts into `grandTotal`:

- Flight price: `basePrice` plus the airline's percentage increment for the order's class, times `purchaseQuantity`.
- Luggage: charged per flight using the airline's `luggageRules`.
- Miles redemption: costs `distance × redeemQuantity` miles, plus the airline's `redeemFee`.

Money columns use `moneyColumn` from `src/shared/common/money.ts` (`numeric(12,2)`, with a transformer because the Postgres driver returns numeric values as strings). Amounts are rounded with `roundMoney` to 2 decimals, and each ticket price is rounded before multiplying by quantity.

**Flight search uses HTTP `QUERY /flights`** with a JSON `SearchFlightsDto` body, and there is no `GET /flights`. The route decorator is `@QueryMethod()`, which needs a newer Nest than 11.0.7 (the project is on 11.2.8); `@Query()` is still the query-string param decorator. In specs, supertest's types need a cast to call it as a method (see `flights.query.e2e.spec.ts`), and with curl use `-X QUERY`. It responds with `PaginatedResult<Flight>` (`items` plus `meta` with `page`, `limit`, `totalItems` and `totalPages`) from `src/shared/pagination/`; `PaginatedFlightsDto` is the concrete class for Swagger.

**Airports come from OurAirports.** `npm run airports:import` (`src/airports/commands/import.airports.command.ts`) boots a small Nest context with only TypeORM, not the whole `AppModule`. It runs from the host like `migration:run`. `AirportsImportService` keeps large and medium airports with an IATA code and upserts them by `iataCode` in one transaction, so existing ids stay stable. `Flight.origin` and `destination` are `ManyToOne` relations to `Airport`. `Flight.setRoute` sets `distance` from `Airport.distanceTo`, the haversine distance in statute miles. `CreateFlightDto` takes nested `AirportDto` objects, but `FlightsUpsertService.create` only uses their `id` and loads the stored rows. Flight search filters by IATA code.

**Spreadsheet imports share `SpreadsheetImporter`** (`src/shared/import/`). `POST /airlines/import` and `POST /airplanes/import` take an .xlsx in the `file` field, find columns by header, validate each row with the module's DTO and save all or nothing. A new import extends the base class (columns, `buildDto`, `toColumnName`, `findConflicts`, `save`) and uses the `@SpreadsheetUpload()` decorator. Sample files live in `data/`.

**Cross-module side effects use `@nestjs/event-emitter`.** Event classes live in the emitting module's `events/` directory, and handlers live in `subscribers/` (currently all under `passengers/`). A subscriber only runs if it is listed in its module's `providers`.

## Work in progress

These parts are incomplete, so check before assuming they work:

- `order.paid` has a subscriber class but nothing emits it, and `AddMilesToUserOnOrderPaid` is not registered in `PassengersModule`.
- `flight.cancelled` is emitted, but its mail subscriber is not registered in `PassengersModule` and its `@OnEvent` listens to `flight.reserved`.
- `OrderCancelService.cancel` and `OrderUpsertService.update` are TODO stubs. `order.suspend.service.ts` is a copy of the cancel service, and `SuspendedOrder` is not registered in `ormConfig.ts`.
- There are no concurrency tests yet. `src/flights/flights.concurrency.e2e.spec.ts` lists them as `it.todo`, waiting on a Postgres test database.
- Cancelling a seat leaves the passenger in `flight_passengers`.
- The airline transformers return JSON strings for `json` columns, so values are stored double-encoded as a JSON string and can't be queried with Postgres JSON operators.
- Many services throw plain `Error` for not-found cases, which surfaces as HTTP 500 rather than 404.

## Deployment

**The Azure deployment is not in use.** The workflow below is still in the repo, but don't rely on it or treat Azure as a deployment target.

Pushing to `main` triggers `.github/workflows/main_flights-management.yml`, which builds on Node 24 and deploys to the Azure Web App `flights-management`. The workflow does not run tests or lint. Application Insights is enabled when `APPLICATION_INSIGHTS_CONNECTION_STRING` is set, and its setup must stay above the app bootstrap in `main.ts`.
