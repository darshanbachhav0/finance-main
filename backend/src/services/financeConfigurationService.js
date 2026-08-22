import FinanceConfiguration from "../models/FinanceConfiguration.js";
import { FINANCE_CONFIGURATION_KEYS } from "../utils/constants.js";
import { addMoney, roundMoney, toMinorUnits } from "../utils/money.js";

function atEndOfDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date();
  return date;
}

export async function getEffectiveFinanceConfiguration(key, date = new Date(), { session } = {}) {
  const effectiveDate = atEndOfDay(date);
  return FinanceConfiguration.findOne({
    key,
    active: true,
    effectiveFrom: { $lte: effectiveDate },
    $or: [
      { effectiveTo: { $exists: false } },
      { effectiveTo: null },
      { effectiveTo: { $gte: effectiveDate } }
    ]
  })
    .sort({ effectiveFrom: -1, createdAt: -1 })
    .session(session || null);
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function evaluateMobilityLines(lines, configuration) {
  if (!configuration) {
    return {
      configured: false,
      key: FINANCE_CONFIGURATION_KEYS.LOCAL_MOBILITY_DAILY_LIMIT,
      warnings: ["Local mobility limit is not configured."],
      dailyTotals: [],
      lineResults: []
    };
  }

  const limit = roundMoney(configuration.numericValue);
  const daily = new Map();
  const lineDates = (lines || []).map((line) => dateKey(line.date));
  for (const [index, line] of (lines || []).entries()) {
    const key = lineDates[index];
    if (!key) continue;
    daily.set(key, addMoney(daily.get(key) || 0, line.amount || 0));
  }

  const dailyTotals = [...daily.entries()].map(([date, amount]) => ({
    date,
    amount,
    limit,
    exceeded: toMinorUnits(amount) > toMinorUnits(limit)
  }));
  const exceededDates = new Set(dailyTotals.filter((item) => item.exceeded).map((item) => item.date));
  const lineResults = (lines || []).map((line, index) => ({
    index,
    date: lineDates[index],
    amount: roundMoney(line.amount || 0),
    exceeded: Boolean(lineDates[index] && exceededDates.has(lineDates[index]))
  }));
  const exceededLineCount = lineResults.filter((item) => item.exceeded).length;

  return {
    configured: true,
    configurationId: configuration._id,
    key: configuration.key,
    configuredValue: limit,
    currency: configuration.currency,
    behavior: configuration.behavior,
    effectiveFrom: configuration.effectiveFrom,
    effectiveTo: configuration.effectiveTo,
    exceededLineCount,
    withinLimit: exceededLineCount === 0,
    outcome: exceededLineCount ? configuration.behavior : "WITHIN_LIMIT",
    shouldBlock: exceededLineCount > 0 && configuration.behavior === "BLOCK",
    dailyTotals,
    lineResults,
    warnings: lineDates.some((value) => !value) ? ["One or more mobility lines have an invalid date."] : []
  };
}

export async function evaluateConfiguredMobilityLines(lines, date = new Date(), options = {}) {
  const configuration = await getEffectiveFinanceConfiguration(
    FINANCE_CONFIGURATION_KEYS.LOCAL_MOBILITY_DAILY_LIMIT,
    date,
    options
  );
  return evaluateMobilityLines(lines, configuration);
}
