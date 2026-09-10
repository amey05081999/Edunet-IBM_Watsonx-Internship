/**
 * In-memory smart meter store.
 *
 * In a real deployment this would be replaced by calls to a smart meter API
 * (e.g. DCC, Octopus Energy, Shelly, Home Assistant REST). All data structures
 * are kept deterministic so unit tests are straightforward.
 */

export interface HourlyReading {
  /** ISO-8601 timestamp for the START of this hour */
  timestamp: string;
  /** kWh consumed in this hour */
  kwh: number;
  /** Temperature in °C at the time (optional — used for weather correlation) */
  tempC?: number;
}

export interface Appliance {
  id: string;
  name: string;
  /** Average watt-hours consumed per use-cycle */
  wattHoursPerCycle: number;
  /** Typical number of cycles per day */
  dailyCycles: number;
  /** Whether the appliance is shift-able to off-peak */
  shiftable: boolean;
  /** Which hours it typically runs (0–23 UTC) */
  activeHours: number[];
}

export interface MeterData {
  meterId: string;
  homeLabel: string;
  tariffId: string;
  readings: HourlyReading[];
  appliances: Appliance[];
}

// ─── Seeded demo dataset ──────────────────────────────────────────────────────

function makeReadings(daysBack: number): HourlyReading[] {
  const readings: HourlyReading[] = [];
  const now = new Date();
  for (let d = daysBack; d >= 0; d--) {
    for (let h = 0; h < 24; h++) {
      const ts = new Date(now);
      ts.setDate(now.getDate() - d);
      ts.setHours(h, 0, 0, 0);

      // Simulate realistic usage patterns
      let base = 0.15; // base load (always-on devices)
      if (h >= 7 && h <= 9) base += 0.55; // morning peak (shower, kettle, toast)
      if (h >= 12 && h <= 13) base += 0.3; // lunch
      if (h >= 17 && h <= 21) base += 0.95; // evening peak (oven, TV, dishwasher)
      if (h >= 22 || h <= 5) base -= 0.05; // overnight — only standby

      // Heating spikes in recent cold week
      const coldWeek = d <= 7;
      const tempC = coldWeek ? 2 + Math.sin(h / 4) * 3 : 14 + Math.sin(h / 6) * 4;
      if (coldWeek && (h <= 8 || h >= 18)) base += 0.8;

      // Add small random noise
      const noise = (Math.sin(d * 31 + h * 7) * 0.08);
      readings.push({
        timestamp: ts.toISOString(),
        kwh: Math.max(0, parseFloat((base + noise).toFixed(3))),
        tempC: parseFloat(tempC.toFixed(1)),
      });
    }
  }
  return readings;
}

export const DEMO_METER: MeterData = {
  meterId: "METER-DEMO-001",
  homeLabel: "12 Elm Street",
  tariffId: "tou",
  readings: makeReadings(30),
  appliances: [
    {
      id: "washer",
      name: "Washing Machine",
      wattHoursPerCycle: 900,
      dailyCycles: 1,
      shiftable: true,
      activeHours: [9, 10],
    },
    {
      id: "dishwasher",
      name: "Dishwasher",
      wattHoursPerCycle: 1200,
      dailyCycles: 1,
      shiftable: true,
      activeHours: [19, 20],
    },
    {
      id: "ev_charger",
      name: "EV Charger",
      wattHoursPerCycle: 7400,
      dailyCycles: 0.5,
      shiftable: true,
      activeHours: [18, 19, 20, 21],
    },
    {
      id: "oven",
      name: "Electric Oven",
      wattHoursPerCycle: 1500,
      dailyCycles: 1,
      shiftable: false,
      activeHours: [17, 18, 19],
    },
    {
      id: "fridge",
      name: "Fridge/Freezer",
      wattHoursPerCycle: 120,
      dailyCycles: 24,
      shiftable: false,
      activeHours: Array.from({ length: 24 }, (_, i) => i),
    },
    {
      id: "heating",
      name: "Electric Heating",
      wattHoursPerCycle: 2000,
      dailyCycles: 2,
      shiftable: false,
      activeHours: [6, 7, 18, 19, 20],
    },
    {
      id: "tv",
      name: "TV & Entertainment",
      wattHoursPerCycle: 200,
      dailyCycles: 4,
      shiftable: false,
      activeHours: [18, 19, 20, 21, 22],
    },
  ],
};

// Simple in-memory store (could be replaced by a DB or external API)
const meters: Map<string, MeterData> = new Map([["METER-DEMO-001", DEMO_METER]]);

export function getMeter(meterId: string): MeterData | undefined {
  return meters.get(meterId);
}

export function listMeterIds(): string[] {
  return Array.from(meters.keys());
}

export function addOrUpdateMeter(data: MeterData): void {
  meters.set(data.meterId, data);
}
