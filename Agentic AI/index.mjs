#!/usr/bin/env node
// Smart Home Energy Advisor — Pre-compiled MCP Server (ES Module)
// Generated from src/index.ts — ready to run with Node.js 18+
// No build step required.

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// TARIFFS
// ─────────────────────────────────────────────────────────────────────────────

const TARIFFS = {
  flat: {
    id: "flat",
    name: "Standard Flat Rate",
    currency: "p/kWh",
    periods: [{ name: "All day", hoursUTC: Array.from({ length: 24 }, (_, i) => i), ratePerKwh: 28 }],
  },
  tou: {
    id: "tou",
    name: "Time-of-Use (Economy 7 style)",
    currency: "p/kWh",
    periods: [
      { name: "Peak (07:00–23:00)", hoursUTC: Array.from({ length: 16 }, (_, i) => i + 7), ratePerKwh: 34 },
      { name: "Off-peak (23:00–07:00)", hoursUTC: [23, 0, 1, 2, 3, 4, 5, 6], ratePerKwh: 13 },
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

function getRateForHour(tariff, hour) {
  for (const period of tariff.periods) {
    if (period.hoursUTC.includes(hour)) return period.ratePerKwh;
  }
  return tariff.periods[0].ratePerKwh;
}

// ─────────────────────────────────────────────────────────────────────────────
// METER STORE  (seeded demo data)
// ─────────────────────────────────────────────────────────────────────────────

function makeReadings(daysBack) {
  const readings = [];
  const now = new Date();
  for (let d = daysBack; d >= 0; d--) {
    for (let h = 0; h < 24; h++) {
      const ts = new Date(now);
      ts.setDate(now.getDate() - d);
      ts.setHours(h, 0, 0, 0);

      let base = 0.15;
      if (h >= 7 && h <= 9) base += 0.55;
      if (h >= 12 && h <= 13) base += 0.3;
      if (h >= 17 && h <= 21) base += 0.95;
      if (h >= 22 || h <= 5) base -= 0.05;

      const coldWeek = d <= 7;
      const tempC = coldWeek ? 2 + Math.sin(h / 4) * 3 : 14 + Math.sin(h / 6) * 4;
      if (coldWeek && (h <= 8 || h >= 18)) base += 0.8;

      const noise = Math.sin(d * 31 + h * 7) * 0.08;
      readings.push({
        timestamp: ts.toISOString(),
        kwh: Math.max(0, parseFloat((base + noise).toFixed(3))),
        tempC: parseFloat(tempC.toFixed(1)),
      });
    }
  }
  return readings;
}

const DEMO_METER = {
  meterId: "METER-DEMO-001",
  homeLabel: "12 Elm Street",
  tariffId: "tou",
  readings: makeReadings(30),
  appliances: [
    { id: "washer", name: "Washing Machine", wattHoursPerCycle: 900, dailyCycles: 1, shiftable: true, activeHours: [9, 10] },
    { id: "dishwasher", name: "Dishwasher", wattHoursPerCycle: 1200, dailyCycles: 1, shiftable: true, activeHours: [19, 20] },
    { id: "ev_charger", name: "EV Charger", wattHoursPerCycle: 7400, dailyCycles: 0.5, shiftable: true, activeHours: [18, 19, 20, 21] },
    { id: "oven", name: "Electric Oven", wattHoursPerCycle: 1500, dailyCycles: 1, shiftable: false, activeHours: [17, 18, 19] },
    { id: "fridge", name: "Fridge/Freezer", wattHoursPerCycle: 120, dailyCycles: 24, shiftable: false, activeHours: Array.from({ length: 24 }, (_, i) => i) },
    { id: "heating", name: "Electric Heating", wattHoursPerCycle: 2000, dailyCycles: 2, shiftable: false, activeHours: [6, 7, 18, 19, 20] },
    { id: "tv", name: "TV & Entertainment", wattHoursPerCycle: 200, dailyCycles: 4, shiftable: false, activeHours: [18, 19, 20, 21, 22] },
  ],
};

const meters = new Map([["METER-DEMO-001", DEMO_METER]]);
const getMeter = (id) => meters.get(id);
const listMeterIds = () => Array.from(meters.keys());
const addOrUpdateMeter = (data) => meters.set(data.meterId, data);

// ─────────────────────────────────────────────────────────────────────────────
// ANALYSIS FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

function readingsForLastNDays(readings, days) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  return readings.filter((r) => new Date(r.timestamp) >= cutoff);
}

function totalKwh(readings) {
  return readings.reduce((s, r) => s + r.kwh, 0);
}

function costForReadings(readings, tariff) {
  return readings.reduce((sum, r) => {
    const hour = new Date(r.timestamp).getUTCHours();
    return sum + r.kwh * getRateForHour(tariff, hour);
  }, 0);
}

function summariseUsage(meter, days) {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recent = readingsForLastNDays(meter.readings, days);
  const kwh = totalKwh(recent);
  const cost = costForReadings(recent, tariff);

  const hourBuckets = Array(24).fill(0);
  const hourCounts = Array(24).fill(0);
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

function explainBill(meter, days) {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recent = readingsForLastNDays(meter.readings, days);
  const older = readingsForLastNDays(meter.readings, days * 2).filter((r) => !recent.includes(r));

  const recentKwh = totalKwh(recent);
  const olderKwh = older.length ? totalKwh(older) : recentKwh;
  const cost = costForReadings(recent, tariff);

  const percentDiff = olderKwh > 0 ? parseFloat((((recentKwh - olderKwh) / olderKwh) * 100).toFixed(1)) : 0;
  const comparedToAvg = percentDiff > 10 ? "above" : percentDiff < -10 ? "below" : "normal";

  const factors = [];
  const tempReadings = recent.filter((r) => r.tempC !== undefined);
  const avgTemp = tempReadings.reduce((s, r) => s + (r.tempC ?? 0), 0) / (tempReadings.length || 1);

  if (avgTemp < 8) {
    factors.push({ factor: "Cold weather", contribution: "high", detail: `Average temperature was ${avgTemp.toFixed(1)} °C — heating demand is significantly elevated.` });
  } else if (avgTemp < 13) {
    factors.push({ factor: "Cool weather", contribution: "medium", detail: `Average temperature was ${avgTemp.toFixed(1)} °C — some extra heating demand.` });
  }

  const eveningKwh = recent.filter((r) => { const h = new Date(r.timestamp).getUTCHours(); return h >= 17 && h <= 21; }).reduce((s, r) => s + r.kwh, 0);
  const eveningShare = eveningKwh / (recentKwh || 1);
  if (eveningShare > 0.4) {
    factors.push({ factor: "Heavy evening peak usage", contribution: "high", detail: `${(eveningShare * 100).toFixed(0)}% of your energy is used 17:00–21:00, the most expensive tariff window.` });
  }

  const ev = meter.appliances.find((a) => a.id === "ev_charger");
  if (ev) {
    factors.push({ factor: "EV charging during peak hours", contribution: "medium", detail: `Your EV charger (${(ev.wattHoursPerCycle / 1000).toFixed(1)} kWh/charge) is set to run 18:00–21:00. Shifting to off-peak could save significantly.` });
  }

  const topConsumers = meter.appliances
    .map((a) => {
      const dailyKwh = (a.wattHoursPerCycle * a.dailyCycles) / 1000;
      const peakRate = Math.max(...a.activeHours.map((h) => getRateForHour(tariff, h)));
      return { name: a.name, estimatedDailyKwh: parseFloat(dailyKwh.toFixed(3)), dailyCost: parseFloat((dailyKwh * peakRate).toFixed(2)) };
    })
    .sort((a, b) => b.dailyCost - a.dailyCost)
    .slice(0, 5);

  return { totalKwh: parseFloat(recentKwh.toFixed(2)), estimatedCost: parseFloat(cost.toFixed(2)), currency: tariff.currency, comparedToAvg, percentDiff, factors, topConsumers };
}

function recommendSchedules(meter) {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recommendations = [];

  for (const appliance of meter.appliances.filter((a) => a.shiftable)) {
    const kwhPerCycle = appliance.wattHoursPerCycle / 1000;
    const cycles = appliance.dailyCycles;
    const currentAvgRate = appliance.activeHours.reduce((s, h) => s + getRateForHour(tariff, h), 0) / (appliance.activeHours.length || 1);

    const windowLen = Math.max(1, appliance.activeHours.length);
    let bestRate = Infinity;
    let bestStart = 0;
    for (let start = 0; start < 24; start++) {
      const windowHours = Array.from({ length: windowLen }, (_, i) => (start + i) % 24);
      const avgRate = windowHours.reduce((s, h) => s + getRateForHour(tariff, h), 0) / windowLen;
      if (avgRate < bestRate) { bestRate = avgRate; bestStart = start; }
    }

    const recommendedHours = Array.from({ length: windowLen }, (_, i) => (bestStart + i) % 24);
    if (bestRate >= currentAvgRate) continue;

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

function detectAnomalies(meter) {
  const anomalies = [];
  const recent = readingsForLastNDays(meter.readings, 7);
  if (recent.length === 0) return anomalies;

  const values = recent.map((r) => r.kwh);
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const stdDev = Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);

  for (const r of recent) {
    if (r.kwh > mean + 3 * stdDev) {
      anomalies.push({ type: "spike", severity: "critical", timestamp: r.timestamp, detail: `Unusually high consumption of ${r.kwh} kWh at ${new Date(r.timestamp).toUTCString()} (${((r.kwh - mean) / stdDev).toFixed(1)}σ above average).` });
    }
  }

  const overnightReadings = recent.filter((r) => { const h = new Date(r.timestamp).getUTCHours(); return h >= 0 && h <= 5; });
  const overnightAvg = overnightReadings.reduce((s, r) => s + r.kwh, 0) / (overnightReadings.length || 1);
  if (overnightAvg > 0.6) {
    anomalies.push({ type: "overnight_drain", severity: "warning", detail: `Average overnight consumption (00:00–06:00) is ${overnightAvg.toFixed(2)} kWh/h. Consider checking always-on devices.` });
  }

  for (let i = 0; i < recent.length - 2; i++) {
    if (recent[i].kwh > mean + 2 * stdDev && recent[i + 1].kwh > mean + 2 * stdDev && recent[i + 2].kwh > mean + 2 * stdDev) {
      anomalies.push({ type: "sustained_high", severity: "warning", timestamp: recent[i].timestamp, detail: `3+ consecutive hours of elevated consumption starting at ${new Date(recent[i].timestamp).toUTCString()}.` });
      i += 2;
    }
  }
  return anomalies;
}

function buildHourlyProfile(meter, days) {
  const tariff = TARIFFS[meter.tariffId] ?? TARIFFS["flat"];
  const recent = readingsForLastNDays(meter.readings, days);
  const buckets = Array(24).fill(0);
  const counts = Array(24).fill(0);
  for (const r of recent) {
    const h = new Date(r.timestamp).getUTCHours();
    buckets[h] += r.kwh;
    counts[h]++;
  }
  return Array.from({ length: 24 }, (_, h) => {
    const avgKwh = counts[h] ? buckets[h] / counts[h] : 0;
    return { hour: h, avgKwh: parseFloat(avgKwh.toFixed(3)), avgCost: parseFloat((avgKwh * getRateForHour(tariff, h)).toFixed(3)), label: `${String(h).padStart(2, "0")}:00` };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MCP SERVER
// ─────────────────────────────────────────────────────────────────────────────

const server = new McpServer({ name: "smart-home-energy-advisor", version: "0.1.0" });

server.registerTool("get_usage_summary", {
  description: "Returns a rolling energy consumption and cost summary for a smart meter over the last N days. Use for total usage, average daily spend, or peak hour questions.",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    days: z.number().int().min(1).max(90).optional().describe("Days to look back. Default: 30."),
  }),
}, async ({ meter_id, days }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found. Available: ${listMeterIds().join(", ")}` }], isError: true };
  const summary = summariseUsage(meter, days ?? 30);
  return { content: [{ type: "text", text: JSON.stringify({ meter: meter.meterId, home: meter.homeLabel, tariff: meter.tariffId, ...summary }, null, 2) }] };
});

server.registerTool("explain_bill", {
  description: "Analyses recent consumption and explains WHY the bill is high or low. Identifies top consuming appliances, weather effects, peak-hour usage, and compares to the previous period. Use for 'why is my bill so high?' questions.",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    days: z.number().int().min(7).max(90).optional().describe("Billing period in days. Default: 30."),
  }),
}, async ({ meter_id, days }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found.` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(explainBill(meter, days ?? 30), null, 2) }] };
});

server.registerTool("recommend_schedules", {
  description: "Recommends the best times to run shiftable appliances (washing machine, dishwasher, EV charger) to minimise electricity costs. Use for 'when should I run the washing machine?' questions.",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
  }),
}, async ({ meter_id }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found.` }], isError: true };
  const recs = recommendSchedules(meter);
  if (recs.length === 0) return { content: [{ type: "text", text: "No scheduling improvements found — your shiftable appliances are already running at optimal times." }] };
  return { content: [{ type: "text", text: JSON.stringify(recs, null, 2) }] };
});

server.registerTool("detect_anomalies", {
  description: "Scans the last 7 days for unusual consumption spikes, sustained high usage, or excessive overnight drain. Use when the user suspects unexpected usage or a fault.",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
  }),
}, async ({ meter_id }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found.` }], isError: true };
  const anomalies = detectAnomalies(meter);
  if (anomalies.length === 0) return { content: [{ type: "text", text: "No anomalies detected in the last 7 days. Consumption looks normal." }] };
  return { content: [{ type: "text", text: JSON.stringify(anomalies, null, 2) }] };
});

server.registerTool("get_hourly_profile", {
  description: "Returns the average kWh and cost for each hour of the day averaged over the last N days. Useful for visualising consumption patterns.",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    days: z.number().int().min(1).max(90).optional().describe("Days to average over. Default: 30."),
  }),
}, async ({ meter_id, days }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found.` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(buildHourlyProfile(meter, days ?? 30), null, 2) }] };
});

server.registerTool("list_appliances", {
  description: "Lists all registered appliances with their energy consumption per cycle and shift-ability.",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
  }),
}, async ({ meter_id }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found.` }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(meter.appliances, null, 2) }] };
});

server.registerTool("add_meter_reading", {
  description: "Ingests a new hourly meter reading (real-time smart meter push or historical backfill).",
  inputSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    timestamp: z.string().describe("ISO-8601 timestamp for the start of the hour (e.g. 2024-11-15T14:00:00Z)."),
    kwh: z.number().min(0).describe("Energy consumed in kWh."),
    temp_c: z.number().optional().describe("Outdoor temperature in °C (optional)."),
  }),
}, async ({ meter_id, timestamp, kwh, temp_c }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  if (!meter) return { content: [{ type: "text", text: `Meter '${id}' not found.` }], isError: true };
  meter.readings.push({ timestamp, kwh, ...(temp_c !== undefined ? { tempC: temp_c } : {}) });
  addOrUpdateMeter(meter);
  return { content: [{ type: "text", text: `Reading added: ${kwh} kWh at ${timestamp}. Total readings: ${meter.readings.length}.` }] };
});

server.registerTool("list_tariffs", {
  description: "Returns all available electricity tariff plans with time-of-use rate schedules.",
  inputSchema: z.object({}),
}, async () => {
  return { content: [{ type: "text", text: JSON.stringify(Object.values(TARIFFS), null, 2) }] };
});

server.registerPrompt("energy_advisor", {
  description: "Conversational prompt that primes the AI as a Smart Home Energy Advisor with live meter context.",
  argsSchema: z.object({
    meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    user_question: z.string().describe("The question the homeowner is asking."),
  }),
}, async ({ meter_id, user_question }) => {
  const id = meter_id ?? "METER-DEMO-001";
  const meter = getMeter(id);
  let contextBlock = "No meter data available.";
  if (meter) {
    const summary = summariseUsage(meter, 30);
    const explanation = explainBill(meter, 30);
    const recs = recommendSchedules(meter);
    const anomalies = detectAnomalies(meter);
    contextBlock = `
METER: ${meter.meterId} — ${meter.homeLabel}
TARIFF: ${meter.tariffId}

=== LAST 30 DAYS ===
Total: ${summary.totalKwh} kWh | Cost: ${summary.totalCost} ${summary.currency}
Daily avg: ${summary.avgDailyKwh} kWh | ${summary.avgDailyCost} ${summary.currency}/day
Peak hour: ${String(summary.peakHour).padStart(2, "0")}:00 UTC (avg ${summary.peakHourAvgKwh} kWh)
vs prev period: ${explanation.comparedToAvg} (${explanation.percentDiff > 0 ? "+" : ""}${explanation.percentDiff}%)

=== TOP COST DRIVERS ===
${explanation.factors.map((f) => `• [${f.contribution.toUpperCase()}] ${f.factor}: ${f.detail}`).join("\n")}

=== TOP APPLIANCES BY DAILY COST ===
${explanation.topConsumers.map((c) => `• ${c.name}: ${c.estimatedDailyKwh} kWh/day → ${c.dailyCost} ${summary.currency}/day`).join("\n")}

=== SCHEDULING SAVINGS ===
${recs.length > 0 ? recs.map((r) => `• ${r.applianceName}: shift to ${String(r.recommendedHours[0]).padStart(2, "0")}:00 → save ${r.annualSaving} ${r.currency}/year`).join("\n") : "None identified."}

=== ANOMALIES (last 7 days) ===
${anomalies.length > 0 ? anomalies.map((a) => `• [${a.severity.toUpperCase()}] ${a.detail}`).join("\n") : "None detected."}`.trim();
  }
  return {
    messages: [{
      role: "user",
      content: {
        type: "text",
        text: `You are a Smart Home Energy Advisor. Help homeowners understand their electricity usage, identify waste, and save money. Be specific and practical.\n\n--- HOME ENERGY DATA ---\n${contextBlock}\n--- END DATA ---\n\nHomeowner's question: "${user_question}"`,
      },
    }],
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// START
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Smart Home Energy Advisor MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
