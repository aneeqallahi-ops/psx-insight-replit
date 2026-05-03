export interface MarketStatusInfo {
  status: string;
  timestamp: number;
  isOpen: boolean;
  label: string;
}

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
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Karachi',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
  const minutes = hour * 60 + minute;
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const isRegularSession = minutes >= 9 * 60 + 30 && minutes <= 15 * 60 + 30;
  const isOpen = isWeekday && isRegularSession;

  return {
    status: isOpen ? 'SCHEDULE_OPEN' : 'SCHEDULE_CLOSED',
    timestamp: now.getTime(),
    isOpen,
    label: isOpen ? 'Market open' : 'Market closed',
  };
}
