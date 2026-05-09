export interface MarketStatusInfo {
  status: string;
  timestamp: number;
  isOpen: boolean;
  label: string;
}

// PSX 2026 public holidays.
// Fixed public holidays are certain; Islamic-calendar dates are approximate
// (Pakistan follows moon-sighting, so actual dates may shift ±1 day).
const PSX_HOLIDAYS_2026 = new Set([
  '2026-02-05', // Kashmir Solidarity Day
  '2026-03-23', // Pakistan Day
  '2026-03-31', // Eid ul Fitr – Day 1 (approx)
  '2026-04-01', // Eid ul Fitr – Day 2 (approx)
  '2026-04-02', // Eid ul Fitr – Day 3 (approx)
  '2026-05-01', // Labour Day
  '2026-06-07', // Eid ul Adha – Day 1 (approx)
  '2026-06-08', // Eid ul Adha – Day 2 (approx)
  '2026-06-09', // Eid ul Adha – Day 3 (approx)
  '2026-06-27', // Ashura – Day 1 (approx)
  '2026-06-28', // Ashura – Day 2 (approx)
  '2026-08-14', // Independence Day
  '2026-09-04', // Eid Milad un Nabi (approx)
  '2026-11-09', // Iqbal Day
  '2026-12-25', // Quaid-e-Azam Day / Christmas
]);

export function describeMarketStatus(status: string, timestamp: number): MarketStatusInfo {
  const normalized = status.trim().toUpperCase();
  const isOpen =
    normalized === 'OPN' ||
    normalized === 'OPEN' ||
    (normalized.includes('OPEN') && !normalized.includes('CLOSE'));

  let label = status || 'Unknown';

  if (normalized === 'OPN' || normalized === 'OPEN') label = 'Market open';
  if (normalized === 'CLS' || normalized.includes('CLOSE')) label = 'Market closed';
  if (normalized === 'PRE' || normalized.includes('PRE')) label = 'Pre-open';
  if (normalized === 'SUS' || normalized.includes('SUSPEND')) label = 'Market suspended';

  return { status, timestamp, isOpen, label };
}

export function describeMarketStatusFromSchedule(now = new Date()): MarketStatusInfo {
  // Parse current time in Asia/Karachi (PKT = UTC+5).
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  const year = get('year');
  const month = get('month');
  const day = get('day');
  const rawHour = Number(get('hour'));
  // hour12:false can emit '24' for midnight on some runtimes
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(get('minute'));

  const dateStr = `${year}-${month}-${day}`;
  const minutes = hour * 60 + minute;

  // Closed on weekends
  if (weekday === 'Sat' || weekday === 'Sun') {
    return { status: 'SCHEDULE_CLOSED', timestamp: now.getTime(), isOpen: false, label: 'Market closed' };
  }

  // Closed on PSX holidays
  if (PSX_HOLIDAYS_2026.has(dateStr)) {
    return { status: 'SCHEDULE_CLOSED', timestamp: now.getTime(), isOpen: false, label: 'Market closed (holiday)' };
  }

  // PSX trading sessions (all times in PKT):
  //   Mon–Thu: 09:30 – 15:30 (continuous)
  //   Fri:     09:30 – 12:00, Jummah break, 14:30 – 15:30
  const OPEN_MIN = 9 * 60 + 30;   // 09:30
  const CLOSE_MIN = 15 * 60 + 30; // 15:30
  const FRI_BREAK_START = 12 * 60;        // 12:00
  const FRI_AFTERNOON_START = 14 * 60 + 30; // 14:30

  let isOpen: boolean;
  if (weekday === 'Fri') {
    const morningSession = minutes >= OPEN_MIN && minutes < FRI_BREAK_START;
    const afternoonSession = minutes >= FRI_AFTERNOON_START && minutes <= CLOSE_MIN;
    isOpen = morningSession || afternoonSession;
  } else {
    isOpen = minutes >= OPEN_MIN && minutes <= CLOSE_MIN;
  }

  return {
    status: isOpen ? 'SCHEDULE_OPEN' : 'SCHEDULE_CLOSED',
    timestamp: now.getTime(),
    isOpen,
    label: isOpen ? 'Market open' : 'Market closed',
  };
}
