import { logger } from '../logger';

interface AnnouncementEmail {
  to: string;
  symbol: string;
  category: string;
  title: string;
  date: string | null;
}

const FROM_EMAIL = process.env.NOTIFY_FROM_EMAIL || 'alerts@psx-insight.local';
const FROM_NAME = process.env.NOTIFY_FROM_NAME || 'PSX Insight Alerts';

function looksLikeEmail(s: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
}

function buildSubject(payload: AnnouncementEmail): string {
  return `[${payload.symbol}] ${payload.category.replace(/_/g, ' ')}: ${payload.title}`.slice(0, 200);
}

function buildText(payload: AnnouncementEmail): string {
  return [
    `Symbol: ${payload.symbol}`,
    `Category: ${payload.category}`,
    `Date: ${payload.date ?? '—'}`,
    '',
    payload.title,
    '',
    `View on PSX Insight: ${process.env.PUBLIC_BASE_URL ?? ''}/events`,
  ].join('\n');
}

/**
 * Sends an announcement email via SendGrid if SENDGRID_API_KEY is configured.
 * Returns true if an email was actually dispatched, false otherwise.
 *
 * If no email provider is configured, this is a no-op that logs the intended
 * delivery so operators can see the pipeline is working end-to-end without
 * needing a third-party integration. The notification is still stored in-app.
 */
export async function sendAnnouncementEmail(payload: AnnouncementEmail): Promise<boolean> {
  if (!looksLikeEmail(payload.to)) return false;

  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    logger.info(
      { to: payload.to, symbol: payload.symbol, category: payload.category },
      'notifications: email provider not configured — alert stored in-app only',
    );
    return false;
  }

  try {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: payload.to }] }],
        from: { email: FROM_EMAIL, name: FROM_NAME },
        subject: buildSubject(payload),
        content: [{ type: 'text/plain', value: buildText(payload) }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      logger.warn({ status: res.status, body }, 'notifications: SendGrid rejected message');
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err }, 'notifications: SendGrid request failed');
    return false;
  }
}
