import { logger } from '../logger';
import { getCachedReport, putCachedReport } from './cache';
import { generateDailyReport } from './daily-report';

const TICK_MS = 30 * 60 * 1000; // 30 minutes
const DAILY_TTL_MS = 24 * 60 * 60 * 1000;
const POST_CLOSE_HOUR_PKT = 16; // PSX closes 15:30; generate after 16:30
const POST_CLOSE_MINUTE_PKT = 30;

declare global {
  // eslint-disable-next-line no-var
  var __psxAgentDailyScheduler: NodeJS.Timeout | undefined;
  // eslint-disable-next-line no-var
  var __psxAgentDailyInFlight: Promise<void> | undefined;
}

function getKarachiClock() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  return { weekday, hour, minute };
}

function todayKey() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function isAfterClose(clock: { hour: number; minute: number }) {
  if (clock.hour > POST_CLOSE_HOUR_PKT) return true;
  if (clock.hour < POST_CLOSE_HOUR_PKT) return false;
  return clock.minute >= POST_CLOSE_MINUTE_PKT;
}

async function checkAndGenerate() {
  const clock = getKarachiClock();
  const isWeekend = clock.weekday === 'Sat' || clock.weekday === 'Sun';

  if (isWeekend) return;
  if (!isAfterClose(clock)) return;

  const key = todayKey();
  const existing = await getCachedReport('market', key);
  if (existing) return;

  // Coalesce concurrent generation attempts (scheduler tick + boot tick + manual refresh races).
  if (globalThis.__psxAgentDailyInFlight) {
    return globalThis.__psxAgentDailyInFlight;
  }

  logger.info({ key, clock }, 'Generating daily market report');
  globalThis.__psxAgentDailyInFlight = (async () => {
    try {
      const report = await generateDailyReport();
      await putCachedReport('market', key, report, DAILY_TTL_MS);
      logger.info({ key, headline: report.headline }, 'Daily market report generated and cached');
    } catch (err) {
      logger.error({ err, key }, 'Daily market report generation failed');
    } finally {
      globalThis.__psxAgentDailyInFlight = undefined;
    }
  })();
  return globalThis.__psxAgentDailyInFlight;
}

export function ensureDailyReportScheduler() {
  if (globalThis.__psxAgentDailyScheduler) return;
  logger.info('Daily market report scheduler armed');
  globalThis.__psxAgentDailyScheduler = setInterval(() => {
    checkAndGenerate().catch((err) => logger.error({ err }, 'scheduler tick failed'));
  }, TICK_MS);
  // Also fire once at boot so a restart in the evening regenerates today's report.
  checkAndGenerate().catch((err) => logger.error({ err }, 'scheduler initial tick failed'));
}
