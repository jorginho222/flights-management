import { ConfigService } from '@nestjs/config';
import { FactoryProvider } from '@nestjs/common';
import {
  DEFAULT_DELAY_TOLERANCE_MINUTES,
  delayToleranceProvider,
} from './flight.delay.tolerance';

describe('delayToleranceProvider', () => {
  const tolerance = (value: string | undefined): number =>
    (delayToleranceProvider as FactoryProvider<number>).useFactory({
      get: () => value,
    } as unknown as ConfigService) as number;

  it.each([undefined, '', '  '])('defaults to 15 minutes for %p', (value) => {
    expect(tolerance(value)).toBe(DEFAULT_DELAY_TOLERANCE_MINUTES);
  });

  it.each([
    ['0', 0],
    ['30', 30],
  ])('reads %s minutes', (value, minutes) => {
    expect(tolerance(value)).toBe(minutes);
  });

  it.each(['-5', '1.5', 'soon'])('rejects %p', (value) => {
    expect(() => tolerance(value)).toThrow(
      'DELAY_TOLERANCE_MINUTES must be a whole number of minutes',
    );
  });
});
