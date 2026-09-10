#!/usr/bin/env node
/**
 * Smart Home Energy Advisor — MCP Server
 *
 * Exposes tools for:
 *   1. get_usage_summary        — rolling consumption & cost summary
 *   2. explain_bill             — AI-style bill breakdown and root-cause factors
 *   3. recommend_schedules      — off-peak shift recommendations per appliance
 *   4. detect_anomalies         — spike and overnight-drain detection
 *   5. get_hourly_profile       — hour-by-hour consumption profile (for charts)
 *   6. list_appliances          — enumerate registered appliances
 *   7. add_meter_reading        — ingest a new hourly reading
 *   8. list_tariffs             — show available tariff plans
 *
 * And one prompt:
 *   energy_advisor              — conversational energy advice
 */

import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

import { getMeter, listMeterIds, addOrUpdateMeter, DEMO_METER } from "./data/meterStore.js";
import {
  summariseUsage,
  explainBill,
  recommendSchedules,
  detectAnomalies,
  buildHourlyProfile,
} from "./analysis/energyAnalysis.js";
import { TARIFFS } from "./data/tariffs.js";

// ─── Server bootstrap ─────────────────────────────────────────────────────────

const server = new McpServer({
  name: "smart-home-energy-advisor",
  version: "0.1.0",
});

// ─── Tool: get_usage_summary ──────────────────────────────────────────────────

server.registerTool(
  "get_usage_summary",
  {
    description:
      "Returns a rolling energy consumption and cost summary for a smart meter over the last N days. " +
      "Use this when the user asks about total usage, average daily spend, or peak hour.",
    inputSchema: z.object({
      meter_id: z
        .string()
        .optional()
        .describe("Meter ID. Defaults to the demo meter (METER-DEMO-001)."),
      days: z
        .number()
        .int()
        .min(1)
        .max(90)
        .optional()
        .describe("Number of days to look back. Default: 30."),
    }),
  },
  async ({ meter_id, days }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found. Available: ${listMeterIds().join(", ")}` }],
        isError: true,
      };
    }
    const summary = summariseUsage(meter, days ?? 30);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              meter: meter.meterId,
              home: meter.homeLabel,
              tariff: meter.tariffId,
              ...summary,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// ─── Tool: explain_bill ───────────────────────────────────────────────────────

server.registerTool(
  "explain_bill",
  {
    description:
      "Analyses recent consumption and explains WHY the bill is high or low. " +
      "Identifies top consuming appliances, weather effects, peak-hour usage, and compares to the previous period. " +
      "Use this when the user asks 'why is my bill so high?' or 'what's driving my costs?'",
    inputSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
      days: z
        .number()
        .int()
        .min(7)
        .max(90)
        .optional()
        .describe("Billing period length in days. Default: 30."),
    }),
  },
  async ({ meter_id, days }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found.` }],
        isError: true,
      };
    }
    const explanation = explainBill(meter, days ?? 30);
    return {
      content: [{ type: "text", text: JSON.stringify(explanation, null, 2) }],
    };
  }
);

// ─── Tool: recommend_schedules ────────────────────────────────────────────────

server.registerTool(
  "recommend_schedules",
  {
    description:
      "Recommends the best times of day to run shiftable appliances (washing machine, dishwasher, EV charger) " +
      "to minimise electricity costs based on the current tariff. " +
      "Use this when the user asks 'when should I run the washing machine?' or 'how can I reduce my bill?'",
    inputSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    }),
  },
  async ({ meter_id }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found.` }],
        isError: true,
      };
    }
    const recs = recommendSchedules(meter);
    if (recs.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No scheduling improvements found — your shiftable appliances are already running at optimal times.",
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(recs, null, 2) }],
    };
  }
);

// ─── Tool: detect_anomalies ───────────────────────────────────────────────────

server.registerTool(
  "detect_anomalies",
  {
    description:
      "Scans the last 7 days of meter data for unusual consumption spikes, sustained high usage, " +
      "or excessive overnight drain. Use when the user asks about unexpected usage or suspects a fault.",
    inputSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    }),
  },
  async ({ meter_id }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found.` }],
        isError: true,
      };
    }
    const anomalies = detectAnomalies(meter);
    if (anomalies.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "No anomalies detected in the last 7 days. Consumption looks normal.",
          },
        ],
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(anomalies, null, 2) }],
    };
  }
);

// ─── Tool: get_hourly_profile ─────────────────────────────────────────────────

server.registerTool(
  "get_hourly_profile",
  {
    description:
      "Returns the average kWh and cost for each hour of the day (00:00–23:00) averaged over the last N days. " +
      "Useful for visualising consumption patterns or identifying peak hours.",
    inputSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
      days: z.number().int().min(1).max(90).optional().describe("Days to average over. Default: 30."),
    }),
  },
  async ({ meter_id, days }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found.` }],
        isError: true,
      };
    }
    const profile = buildHourlyProfile(meter, days ?? 30);
    return {
      content: [{ type: "text", text: JSON.stringify(profile, null, 2) }],
    };
  }
);

// ─── Tool: list_appliances ────────────────────────────────────────────────────

server.registerTool(
  "list_appliances",
  {
    description:
      "Lists all registered appliances for a meter, including their estimated energy consumption per cycle " +
      "and whether they can be shifted to cheaper times.",
    inputSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
    }),
  },
  async ({ meter_id }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found.` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(meter.appliances, null, 2) }],
    };
  }
);

// ─── Tool: add_meter_reading ──────────────────────────────────────────────────

server.registerTool(
  "add_meter_reading",
  {
    description:
      "Ingests a new hourly meter reading. Use this to simulate real smart meter data push or " +
      "to add historical readings for analysis.",
    inputSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
      timestamp: z
        .string()
        .describe("ISO-8601 timestamp for the start of the hour (e.g. 2024-11-15T14:00:00Z)."),
      kwh: z.number().min(0).describe("Energy consumed in this hour in kWh."),
      temp_c: z.number().optional().describe("Outdoor temperature in °C at this time (optional)."),
    }),
  },
  async ({ meter_id, timestamp, kwh, temp_c }) => {
    const id = meter_id ?? "METER-DEMO-001";
    const meter = getMeter(id);
    if (!meter) {
      return {
        content: [{ type: "text", text: `Meter '${id}' not found.` }],
        isError: true,
      };
    }
    meter.readings.push({
      timestamp,
      kwh,
      ...(temp_c !== undefined ? { tempC: temp_c } : {}),
    });
    addOrUpdateMeter(meter);
    return {
      content: [
        {
          type: "text",
          text: `Reading added: ${kwh} kWh at ${timestamp}. Total readings: ${meter.readings.length}.`,
        },
      ],
    };
  }
);

// ─── Tool: list_tariffs ───────────────────────────────────────────────────────

server.registerTool(
  "list_tariffs",
  {
    description:
      "Returns all available electricity tariff plans with their time-of-use rate schedules. " +
      "Use to answer questions about pricing or to help users pick the right tariff.",
    inputSchema: z.object({}),
  },
  async () => {
    return {
      content: [{ type: "text", text: JSON.stringify(Object.values(TARIFFS), null, 2) }],
    };
  }
);

// ─── Prompt: energy_advisor ───────────────────────────────────────────────────

server.registerPrompt(
  "energy_advisor",
  {
    description:
      "A conversational prompt that primes the AI to act as a Smart Home Energy Advisor. " +
      "Includes the user's current usage summary and bill explanation as context.",
    argsSchema: z.object({
      meter_id: z.string().optional().describe("Meter ID. Defaults to METER-DEMO-001."),
      user_question: z.string().describe("The question the homeowner is asking."),
    }),
  },
  async ({ meter_id, user_question }) => {
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
Total consumption: ${summary.totalKwh} kWh
Estimated cost: ${summary.totalCost} ${summary.currency}
Daily average: ${summary.avgDailyKwh} kWh / ${summary.avgDailyCost} ${summary.currency}
Peak hour: ${String(summary.peakHour).padStart(2, "0")}:00 UTC (avg ${summary.peakHourAvgKwh} kWh)
vs previous period: ${explanation.comparedToAvg} (${explanation.percentDiff > 0 ? "+" : ""}${explanation.percentDiff}%)

=== TOP COST DRIVERS ===
${explanation.factors.map((f) => `• [${f.contribution.toUpperCase()}] ${f.factor}: ${f.detail}`).join("\n")}

=== TOP APPLIANCES BY DAILY COST ===
${explanation.topConsumers.map((c) => `• ${c.name}: ${c.estimatedDailyKwh} kWh/day → ${c.dailyCost} ${summary.currency}/day`).join("\n")}

=== SCHEDULING SAVINGS ===
${recs.length > 0 ? recs.map((r) => `• ${r.applianceName}: shift to ${String(r.recommendedHours[0]).padStart(2, "0")}:00 → save ${r.annualSaving} ${r.currency}/year`).join("\n") : "No shiftable appliances found."}

=== ANOMALIES (last 7 days) ===
${anomalies.length > 0 ? anomalies.map((a) => `• [${a.severity.toUpperCase()}] ${a.detail}`).join("\n") : "None detected."}
`.trim();
    }

    return {
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `You are a Smart Home Energy Advisor. You help homeowners understand their electricity usage, identify waste, and save money. Be specific, practical, and friendly. Use the data below to answer the question.

--- HOME ENERGY DATA ---
${contextBlock}
--- END DATA ---

Homeowner's question: "${user_question}"`,
          },
        },
      ],
    };
  }
);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Smart Home Energy Advisor MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in MCP server:", error);
  process.exit(1);
});
