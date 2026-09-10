# Smart Home Energy Advisor — MCP Server

An MCP server that acts as a personal electricity manager. It ingests smart meter data and appliance information, analyses power consumption patterns, and provides actionable recommendations.

## Tools

| Tool | Description |
|------|-------------|
| `get_usage_summary` | Rolling 30-day consumption & cost summary with peak-hour detection |
| `explain_bill` | Root-cause analysis of why the bill is high — weather, peak usage, top appliances |
| `recommend_schedules` | Off-peak shift recommendations for shiftable appliances with annual saving estimate |
| `detect_anomalies` | Spike, sustained-high, and overnight-drain detection over the last 7 days |
| `get_hourly_profile` | Hour-by-hour average consumption and cost profile (for charts) |
| `list_appliances` | Enumerate all registered appliances and their energy profiles |
| `add_meter_reading` | Ingest a new hourly reading (real-time push) |
| `list_tariffs` | Show available tariff plans (flat, time-of-use, dynamic/agile) |

## Prompt

- **`energy_advisor`** — Conversational prompt that primes the AI with live meter data and lets you ask any energy question in plain English.

## Example questions

- *"Why is my bill so high this month?"*
- *"What time should I run the washing machine?"*
- *"Is my EV charger costing me too much?"*
- *"Are there any unusual spikes in my usage?"*
- *"Show me my hour-by-hour consumption pattern."*

## Setup

```bash
npm install
npm run build
```

Register in Bob's `mcp.json`:

```json
{
  "mcpServers": {
    "smart-home-energy-advisor": {
      "command": "node",
      "args": ["/absolute/path/to/smart-home-energy-advisor/build/index.js"]
    }
  }
}
```

## Architecture

```
src/
  index.ts                  ← MCP server entry point (tools + prompt)
  data/
    meterStore.ts           ← In-memory meter/appliance store + demo data
    tariffs.ts              ← Tariff schedules (flat / TOU / dynamic)
  analysis/
    energyAnalysis.ts       ← Pure analysis functions
```

The demo meter (`METER-DEMO-001`) ships with 30 days of realistic simulated data including cold-weather heating spikes, morning/evening peaks, and an EV charger running at peak hours — so you can explore all recommendations immediately without connecting real hardware.

To connect real meter data, replace `getMeter()` in `meterStore.ts` with calls to your smart meter API (DCC, Octopus Energy, Shelly, Home Assistant, etc.).
