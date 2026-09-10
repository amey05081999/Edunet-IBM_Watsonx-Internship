/**
 * Pure analysis functions — no side effects, easy to unit-test.
 */

import { HourlyReading, MeterData, Appliance } from "../data/meterStore.js";
import { TARIFFS, getRateForHour, Tariff } from "../data/tariffs.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readingsForLastNDays(readings: HourlyReading[], days: number): HourlyReading[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return readings.filter((r) => new Date(r.timestamp) >= cutoff);
}

function totalKwh(readings: HourlyReading[]): number {
  return readings.reduce((s, r) => s + r.kwh, 0);
}

function costForReadings(readings: HourlyReading[], tariff: Tariff): number {
  return readings.reduce((sum, r) => {
    const hour = new Date(r.timestamp).getUTCHours();
    return sum + r.kwh * getRateForHour(tariff, hour);
  }, 0);
}

// ─── Exported analysis functions ─────────────────────────────────────────────

export interface UsageSummary {
  periodDays: number;
  totalKwh: number;
  totalCost: number; // in tariff currency units (e.g. pence)
  avgDailyKwh: number;
  avgDailyCost: number;
  peakHour: number; // UTC hour with highest average consumption
  peakHourAvgKwh: number;
  currency: string;
}

export function summariseUsage(meter: MeterData, days: number): UsageSummary {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recent = readingsForLastNDays(meter.readings, days);
  const kwh = totalKwh(recent);
  const cost = costForReadings(recent, tariff);

  // Build hourly profile
  const hourBuckets: number[] = Array(24).fill(0);
  const hourCounts: number[] = Array(24).fill(0);
  for (const r of recent) {
    const h = new Date(r.timestamp).getUTCHours();
    hourBuckets[h] += r.kwh;
    hourCounts[h]++;
  }
  const hourAvgs = hourBuckets.map((total, h) => (hourCounts[h] ? total / hourCounts[h] : 0));
  const peakHour = hourAvgs.indexOf(Math.max(...hourAvgs));

  return {
    periodDays: days,
    totalKwh: parseFloat(kwh.toFixed(2)),
    totalCost: parseFloat(cost.toFixed(2)),
    avgDailyKwh: parseFloat((kwh / days).toFixed(2)),
    avgDailyCost: parseFloat((cost / days).toFixed(2)),
    peakHour,
    peakHourAvgKwh: parseFloat(hourAvgs[peakHour].toFixed(3)),
    currency: tariff.currency,
  };
}

// ─── Bill explainer ───────────────────────────────────────────────────────────

export interface BillFactor {
  factor: string;
  contribution: "high" | "medium" | "low";
  detail: string;
}

export interface BillExplanation {
  totalKwh: number;
  estimatedCost: number;
  currency: string;
  comparedToAvg: "above" | "below" | "normal";
  percentDiff: number;
  factors: BillFactor[];
  topConsumers: { name: string; estimatedDailyKwh: number; dailyCost: number }[];
}

export function explainBill(meter: MeterData, days: number): BillExplanation {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recent = readingsForLastNDays(meter.readings, days);
  const older = readingsForLastNDays(meter.readings, days * 2).filter(
    (r) => !recent.includes(r)
  );

  const recentKwh = totalKwh(recent);
  const olderKwh = older.length ? totalKwh(older) : recentKwh;
  const cost = costForReadings(recent, tariff);

  const percentDiff =
    olderKwh > 0 ? parseFloat((((recentKwh - olderKwh) / olderKwh) * 100).toFixed(1)) : 0;

  const comparedToAvg: "above" | "below" | "normal" =
    percentDiff > 10 ? "above" : percentDiff < -10 ? "below" : "normal";

  const factors: BillFactor[] = [];

  // Cold weather check
  const avgTemp =
    recent.filter((r) => r.tempC !== undefined).reduce((s, r) => s + (r.tempC ?? 0), 0) /
    (recent.filter((r) => r.tempC !== undefined).length || 1);
  if (avgTemp < 8) {
    factors.push({
      factor: "Cold weather",
      contribution: "high",
      detail: `Average temperature was ${avgTemp.toFixed(1)} °C — heating demand is significantly elevated.`,
    });
  } else if (avgTemp < 13) {
    factors.push({
      factor: "Cool weather",
      contribution: "medium",
      detail: `Average temperature was ${avgTemp.toFixed(1)} °C — some extra heating demand.`,
    });
  }

  // Evening peak usage
  const eveningKwh = recent
    .filter((r) => {
      const h = new Date(r.timestamp).getUTCHours();
      return h >= 17 && h <= 21;
    })
    .reduce((s, r) => s + r.kwh, 0);
  const eveningShare = eveningKwh / (recentKwh || 1);
  if (eveningShare > 0.4) {
    factors.push({
      factor: "Heavy evening peak usage",
      contribution: "high",
      detail: `${(eveningShare * 100).toFixed(0)}% of your energy is used 17:00–21:00, which is the most expensive tariff window.`,
    });
  }

  // EV charger if present
  const ev = meter.appliances.find((a) => a.id === "ev_charger");
  if (ev) {
    factors.push({
      factor: "EV charging during peak hours",
      contribution: "medium",
      detail: `Your EV charger (${(ev.wattHoursPerCycle / 1000).toFixed(1)} kWh/charge) is set to run 18:00–21:00. Shifting to off-peak could save significantly.`,
    });
  }

  // Compute top consumers
  const topConsumers = meter.appliances
    .map((a) => {
      const dailyKwh = (a.wattHoursPerCycle * a.dailyCycles) / 1000;
      const peakRate = Math.max(...a.activeHours.map((h) => getRateForHour(tariff, h)));
      return {
        name: a.name,
        estimatedDailyKwh: parseFloat(dailyKwh.toFixed(3)),
        dailyCost: parseFloat((dailyKwh * peakRate).toFixed(2)),
      };
    })
    .sort((a, b) => b.dailyCost - a.dailyCost)
    .slice(0, 5);

  return {
    totalKwh: parseFloat(recentKwh.toFixed(2)),
    estimatedCost: parseFloat(cost.toFixed(2)),
    currency: tariff.currency,
    comparedToAvg,
    percentDiff,
    factors,
    topConsumers,
  };
}

// ─── Scheduling recommender ───────────────────────────────────────────────────

export interface ScheduleRecommendation {
  applianceId: string;
  applianceName: string;
  currentHours: number[];
  recommendedHours: number[];
  currentDailyCost: number;
  optimisedDailyCost: number;
  annualSaving: number;
  currency: string;
  reason: string;
}

export function recommendSchedules(meter: MeterData): ScheduleRecommendation[] {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recommendations: ScheduleRecommendation[] = [];

  for (const appliance of meter.appliances.filter((a) => a.shiftable)) {
    const kwhPerCycle = appliance.wattHoursPerCycle / 1000;
    const cycles = appliance.dailyCycles;

    const currentAvgRate =
      appliance.activeHours.reduce((s, h) => s + getRateForHour(tariff, h), 0) /
      (appliance.activeHours.length || 1);

    // Find cheapest contiguous window of the same length
    const windowLen = Math.max(1, appliance.activeHours.length);
    let bestRate = Infinity;
    let bestStart = 0;
    for (let start = 0; start < 24; start++) {
      const windowHours = Array.from({ length: windowLen }, (_, i) => (start + i) % 24);
      const avgRate =
        windowHours.reduce((s, h) => s + getRateForHour(tariff, h), 0) / windowLen;
      if (avgRate < bestRate) {
        bestRate = avgRate;
        bestStart = start;
      }
    }

    const recommendedHours = Array.from({ length: windowLen }, (_, i) => (bestStart + i) % 24);

    if (bestRate >= currentAvgRate) continue; // no improvement

    const currentDailyCost = currentAvgRate * kwhPerCycle * cycles;
    const optimisedDailyCost = bestRate * kwhPerCycle * cycles;
    const annualSaving = (currentDailyCost - optimisedDailyCost) * 365;

    recommendations.push({
      applianceId: appliance.id,
      applianceName: appliance.name,
      currentHours: appliance.activeHours,
      recommendedHours,
      currentDailyCost: parseFloat(currentDailyCost.toFixed(2)),
      optimisedDailyCost: parseFloat(optimisedDailyCost.toFixed(2)),
      annualSaving: parseFloat(annualSaving.toFixed(2)),
      currency: tariff.currency,
      reason: `Shift from peak rate (${currentAvgRate.toFixed(0)} ${tariff.currency}) to off-peak rate (${bestRate.toFixed(0)} ${tariff.currency}) by running between ${String(bestStart).padStart(2, "0")}:00 and ${String((bestStart + windowLen) % 24).padStart(2, "0")}:00.`,
    });
  }

  return recommendations.sort((a, b) => b.annualSaving - a.annualSaving);
}

// ─── Anomaly / pattern detector ──────────────────────────────────────────────

export interface Anomaly {
  type: "spike" | "sustained_high" | "overnight_drain" | "unusual_pattern";
  severity: "warning" | "critical";
  timestamp?: string;
  detail: string;
}

export function detectAnomalies(meter: MeterData): Anomaly[] {
  const anomalies: Anomaly[] = [];
  const recent = readingsForLastNDays(meter.readings, 7);
  if (recent.length === 0) return anomalies;

  const values = recent.map((r) => r.kwh);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);

  for (const r of recent) {
    if (r.kwh > mean + 3 * stdDev) {
      anomalies.push({
        type: "spike",
        severity: "critical",
        timestamp: r.timestamp,
        detail: `Unusually high consumption of ${r.kwh} kWh at ${new Date(r.timestamp).toUTCString()} (${((r.kwh - mean) / stdDev).toFixed(1)}σ above average).`,
      });
    }
  }

  // Overnight drain check (00:00–05:00 average > 0.6 kWh)
  const overnightReadings = recent.filter((r) => {
    const h = new Date(r.timestamp).getUTCHours();
    return h >= 0 && h <= 5;
  });
  const overnightAvg =
    overnightReadings.reduce((s, r) => s + r.kwh, 0) / (overnightReadings.length || 1);
  if (overnightAvg > 0.6) {
    anomalies.push({
      type: "overnight_drain",
      severity: "warning",
      detail: `Average overnight consumption (00:00–06:00) is ${overnightAvg.toFixed(2)} kWh/h. Consider checking always-on devices and standby appliances.`,
    });
  }

  // Sustained high — any 3 consecutive hours each > mean + 2σ
  for (let i = 0; i < recent.length - 2; i++) {
    if (
      recent[i].kwh > mean + 2 * stdDev &&
      recent[i + 1].kwh > mean + 2 * stdDev &&
      recent[i + 2].kwh > mean + 2 * stdDev
    ) {
      anomalies.push({
        type: "sustained_high",
        severity: "warning",
        timestamp: recent[i].timestamp,
        detail: `3+ consecutive hours of elevated consumption starting at ${new Date(recent[i].timestamp).toUTCString()}. Average: ${((recent[i].kwh + recent[i + 1].kwh + recent[i + 2].kwh) / 3).toFixed(2)} kWh/h.`,
      });
      i += 2; // skip ahead
    }
  }

  return anomalies;
}

// ─── Hourly profile builder (for display / charting) ─────────────────────────

export interface HourlyProfile {
  hour: number;
  avgKwh: number;
  avgCost: number;
  label: string;
}

export function buildHourlyProfile(meter: MeterData, days: number): HourlyProfile[] {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recent = readingsForLastNDays(meter.readings, days);

  const buckets: number[] = Array(24).fill(0);
  const counts: number[] = Array(24).fill(0);
  for (const r of recent) {
    const h = new Date(r.timestamp).getUTCHours();
    buckets[h] += r.kwh;
    counts[h]++;
  }

  return Array.from({ length: 24 }, (_, h) => {
    const avgKwh = counts[h] ? buckets[h] / counts[h] : 0;
    const rate = getRateForHour(tariff, h);
    return {
      hour: h,
      avgKwh: parseFloat(avgKwh.toFixed(3)),
      avgCost: parseFloat((avgKwh * rate).toFixed(3)),
      label: `${String(h).padStart(2, "0")}:00`,
    };
  });
}
