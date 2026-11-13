import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export const DEFAULT_DELAY_TOLERANCE_MINUTES = 15;

/** Injection token for how many minutes past its departure a flight still on the ground is delayed. */
export const DELAY_TOLERANCE_MINUTES = 'DELAY_TOLERANCE_MINUTES';

export const delayToleranceProvider: Provider = {
  provide: DELAY_TOLERANCE_MINUTES,
  inject: [ConfigService],
  useFactory: (config: ConfigService): number => {
    const value = config.get<string>('DELAY_TOLERANCE_MINUTES');
    if (value === undefined || value.trim() === '') {
      return DEFAULT_DELAY_TOLERANCE_MINUTES;
    }

    const minutes = Number(value);
    if (!Number.isInteger(minutes) || minutes < 0) {
      throw new Error(
        `DELAY_TOLERANCE_MINUTES must be a whole number of minutes, got "${value}"`,
      );
    }
    return minutes;
  },
};
