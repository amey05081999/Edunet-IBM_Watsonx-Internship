/**
 * Electricity tariff schedules.
 * Prices are in pence-per-kWh (easily swapped for cents or any currency unit).
 */

export interface TariffPeriod {
  name: string;
  hoursUTC: number[]; // 0–23
  ratePerKwh: number; // in the user's currency minor unit (e.g. pence)
}

export interface Tariff {
  id: string;
  name: string;
  currency: string;
  periods: TariffPeriod[];
}

export const TARIFFS: Record<string, Tariff> = {
  flat: {
    id: "flat",
    name: "Standard Flat Rate",
    currency: "p/kWh",
    periods: [
      {
        name: "All day",
        hoursUTC: Array.from({ length: 24 }, (_, i) => i),
        ratePerKwh: 28,
      },
    ],
  },
  tou: {
    id: "tou",
    name: "Time-of-Use (Economy 7 style)",
    currency: "p/kWh",
    periods: [
      {
        name: "Peak (07:00–23:00)",
        hoursUTC: Array.from({ length: 16 }, (_, i) => i + 7),
        ratePerKwh: 34,
      },
      {
        name: "Off-peak (23:00–07:00)",
        hoursUTC: [23, 0, 1, 2, 3, 4, 5, 6],
        ratePerKwh: 13,
      },
    ],
  },
  dynamic: {
    id: "dynamic",
    name: "Dynamic / Agile",
    currency: "p/kWh",
    periods: [
      { name: "Night (00:00–06:00)", hoursUTC: [0, 1, 2, 3, 4, 5], ratePerKwh: 10 },
      { name: "Morning (06:00–09:00)", hoursUTC: [6, 7, 8], ratePerKwh: 36 },
      { name: "Day (09:00–16:00)", hoursUTC: [9, 10, 11, 12, 13, 14, 15], ratePerKwh: 24 },
      { name: "Evening peak (16:00–21:00)", hoursUTC: [16, 17, 18, 19, 20], ratePerKwh: 42 },
      { name: "Late evening (21:00–00:00)", hoursUTC: [21, 22, 23], ratePerKwh: 20 },
    ],
  },
};

export function getRateForHour(tariff: Tariff, hour: number): number {
  for (const period of tariff.periods) {
    if (period.hoursUTC.includes(hour)) return period.ratePerKwh;
  }
  return tariff.periods[0].ratePerKwh;
}
