import { Airport } from './airport.entity';

const airportAt = (latitude: number, longitude: number): Airport =>
  Object.assign(new Airport(), { latitude, longitude });

describe('Airport', () => {
  describe('distanceTo', () => {
    const ezeiza = airportAt(-34.8222, -58.5358);
    const cordoba = airportAt(-31.3236, -64.208);
    const jfk = airportAt(40.6398, -73.7789);
    const heathrow = airportAt(51.4706, -0.461941);

    it('returns the great-circle distance in statute miles', () => {
      expect(ezeiza.distanceTo(cordoba)).toBeGreaterThan(395);
      expect(ezeiza.distanceTo(cordoba)).toBeLessThan(410);
      expect(jfk.distanceTo(heathrow)).toBeGreaterThan(3430);
      expect(jfk.distanceTo(heathrow)).toBeLessThan(3470);
    });

    it('is the same in both directions', () => {
      expect(heathrow.distanceTo(jfk)).toBe(jfk.distanceTo(heathrow));
    });

    it('is 0 for the same point', () => {
      expect(ezeiza.distanceTo(airportAt(-34.8222, -58.5358))).toBe(0);
    });

    it('rounds to a whole mile', () => {
      expect(Number.isInteger(jfk.distanceTo(cordoba))).toBe(true);
    });
  });
});
