import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, Check, Mail, RefreshCw } from 'lucide-react';
import {
  ALL_CATEGORIES,
  fetchNotificationPreferences,
  fetchNotifications,
  markNotificationsRead,
  pollNotificationsNow,
  saveNotificationPreferences,
  type NotificationCategory,
  type NotificationPreferences,
} from '@/lib/notifications';

function formatDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Karachi',
  }).format(d).toUpperCase();
}

export function AlertsPage() {
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'all'],
    queryFn: () => fetchNotifications({ limit: 100 }),
    refetchInterval: 60_000,
  });

  const preferencesQuery = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: fetchNotificationPreferences,
  });

  const [prefsDraft, setPrefsDraft] = useState<NotificationPreferences | null>(null);
  useEffect(() => {
    if (preferencesQuery.data && !prefsDraft) {
      setPrefsDraft(preferencesQuery.data);
    }
  }, [preferencesQuery.data, prefsDraft]);

  const markReadMutation = useMutation({
    mutationFn: (input: { ids?: number[]; all?: boolean }) => markNotificationsRead(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const savePrefsMutation = useMutation({
    mutationFn: (next: NotificationPreferences) => saveNotificationPreferences(next),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notification-preferences'] }),
  });

  const pollMutation = useMutation({
    mutationFn: () => pollNotificationsNow(),
    onSuccess: () => {
      // Give the backend a moment to finish writing rows before refetching.
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }), 1500);
    },
  });

  const items = useMemo(() => notificationsQuery.data?.items ?? [], [notificationsQuery.data]);
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  const toggleCategory = (cat: NotificationCategory) => {
    if (!prefsDraft) return;
    const has = prefsDraft.categories.includes(cat);
    const next = has
      ? prefsDraft.categories.filter((c) => c !== cat)
      : [...prefsDraft.categories, cat];
    setPrefsDraft({ ...prefsDraft, categories: next });
  };

  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <header className="flex flex-col gap-4 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-coral tracking-widest">009 // ALERTS</span>
            <span className="flex-1 h-px bg-coral/20" />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="font-display text-5xl tracking-wide text-white lg:text-7xl">ALERTS</h1>
            <p className="font-mono text-xs uppercase tracking-wider text-gray-500">
              // CORPORATE EVENTS DETECTED FOR STOCKS IN YOUR PORTFOLIO
            </p>
          </div>
        </header>

        <section className="grid gap-6 lg:grid-cols-[2fr_1fr]">
          <div className="border border-line bg-panel">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <div className="flex items-center gap-3">
                <BellRing className="h-4 w-4 text-coral" aria-hidden="true" />
                <p className="font-mono text-[11px] uppercase tracking-wider text-coral">Recent Alerts</p>
                {unreadCount > 0 ? (
                  <span className="border border-coral/40 bg-coral/10 px-2 py-0.5 font-mono text-[10px] uppercase text-coral">
                    {unreadCount} new
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2">
                {import.meta.env.DEV ? (
                  <button
                    type="button"
                    disabled={pollMutation.isPending}
                    onClick={() => pollMutation.mutate()}
                    title="Development only — production uses the scheduled 15-minute tick"
                    className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[10px] uppercase text-gray-300 transition hover:border-coral hover:text-coral disabled:opacity-40"
                  >
                    <RefreshCw className={`h-3 w-3 ${pollMutation.isPending ? 'animate-spin' : ''}`} /> Poll now
                  </button>
                ) : null}
                {unreadCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => markReadMutation.mutate({ all: true })}
                    className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[10px] uppercase text-gray-300 transition hover:border-coral hover:text-coral"
                  >
                    <Check className="h-3 w-3" /> Mark all read
                  </button>
                ) : null}
              </div>
            </div>

            <div className="divide-y divide-line/60">
              {notificationsQuery.isLoading ? (
                <p className="p-4 font-mono text-xs text-gray-500">LOADING ALERTS…</p>
              ) : items.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="font-mono text-xs text-gray-500">
                    No alerts yet. Add holdings to your{' '}
                    <Link href="/watchlist" className="text-coral hover:underline">portfolio</Link>{' '}
                    and we&apos;ll notify you when new announcements arrive.
                  </p>
                </div>
              ) : (
                items.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 px-4 py-3 ${!item.readAt ? 'bg-coral/5' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {!item.readAt ? <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" /> : null}
                        <span className="border border-line bg-black/30 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-gray-300">
                          {item.category.replace(/_/g, ' ')}
                        </span>
                        <Link
                          href={`/stock?symbol=${encodeURIComponent(item.symbol)}`}
                          className="font-mono text-sm font-semibold text-white hover:text-coral"
                        >
                          {item.symbol}
                        </Link>
                        <span className="font-mono text-[10px] text-gray-500">
                          · {formatDateTime(item.createdAt)}
                        </span>
                        {item.emailSent ? (
                          <span title="Email sent" className="ml-2 inline-flex items-center gap-1 font-mono text-[10px] text-emerald-300">
                            <Mail className="h-3 w-3" /> EMAILED
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-mono text-xs text-gray-200 leading-snug">{item.title}</p>
                    </div>
                    {!item.readAt ? (
                      <button
                        type="button"
                        onClick={() => markReadMutation.mutate({ ids: [item.id] })}
                        className="border border-line px-2 py-1 font-mono text-[10px] uppercase text-gray-400 transition hover:border-coral hover:text-coral"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </div>

          <aside className="border border-line bg-panel p-5">
            <p className="font-mono text-[11px] uppercase tracking-wider text-coral">Preferences</p>
            <p className="mt-2 font-mono text-[11px] text-gray-500 leading-relaxed">
              Choose which announcement types trigger alerts. Leave all unselected to receive every new event.
            </p>

            {prefsDraft ? (
              <>
                <div className="mt-4 flex flex-wrap gap-2">
                  {ALL_CATEGORIES.map((cat) => {
                    const active = prefsDraft.categories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleCategory(cat)}
                        className={`border px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
                          active
                            ? 'border-coral bg-coral/15 text-coral'
                            : 'border-line text-gray-400 hover:border-coral/60 hover:text-coral'
                        }`}
                      >
                        {cat.replace(/_/g, ' ')}
                      </button>
                    );
                  })}
                </div>

                <div className="mt-5 border-t border-line pt-4">
                  <label className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-gray-300">
                    <input
                      type="checkbox"
                      checked={prefsDraft.inAppEnabled}
                      onChange={(e) => setPrefsDraft({ ...prefsDraft, inAppEnabled: e.target.checked })}
                      className="accent-coral"
                    />
                    In-app notifications
                  </label>
                </div>

                <div className="mt-4 border-t border-line pt-4">
                  <label className="block font-mono text-[10px] uppercase text-gray-500 mb-1">EMAIL ADDRESS</label>
                  <input
                    type="email"
                    value={prefsDraft.email ?? ''}
                    onChange={(e) => setPrefsDraft({ ...prefsDraft, email: e.target.value || null })}
                    placeholder="you@example.com"
                    className="w-full h-9 border border-line bg-black/30 px-3 font-mono text-xs text-white outline-none focus:border-coral"
                  />
                  <label className="mt-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-gray-300">
                    <input
                      type="checkbox"
                      checked={prefsDraft.emailEnabled}
                      onChange={(e) => setPrefsDraft({ ...prefsDraft, emailEnabled: e.target.checked })}
                      className="accent-coral"
                      disabled={!prefsDraft.email}
                    />
                    Send email alerts
                  </label>
                  <p className="mt-2 font-mono text-[10px] text-gray-500 leading-relaxed">
                    Email delivery is best-effort and requires an email provider to be configured by the operator.
                    In-app alerts always work.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={savePrefsMutation.isPending}
                  onClick={() => savePrefsMutation.mutate(prefsDraft)}
                  className="mt-5 inline-flex w-full items-center justify-center gap-2 border border-coral bg-coral/15 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-coral transition hover:bg-coral/25 disabled:opacity-40"
                >
                  {savePrefsMutation.isPending ? 'SAVING…' : savePrefsMutation.isSuccess ? 'SAVED ✓' : 'SAVE PREFERENCES'}
                </button>
                {savePrefsMutation.isError ? (
                  <p className="mt-2 font-mono text-[10px] text-rose-300">Could not save. Try again.</p>
                ) : null}
              </>
            ) : (
              <p className="mt-4 font-mono text-xs text-gray-500">LOADING…</p>
            )}
          </aside>
        </section>
      </div>
    </main>
  );
}
