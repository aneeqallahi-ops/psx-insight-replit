import { useEffect, useRef, useState } from 'react';
import { Link } from 'wouter';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Check, Settings as SettingsIcon } from 'lucide-react';
import {
  fetchNotifications,
  markNotificationsRead,
  type NotificationItem,
} from '@/lib/notifications';

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => fetchNotifications({ limit: 10 }),
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
  });

  const markReadMutation = useMutation({
    mutationFn: (input: { ids?: number[]; all?: boolean }) => markNotificationsRead(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        className="relative flex items-center justify-center border border-line bg-black/30 p-2 text-gray-300 transition hover:border-coral hover:text-coral"
      >
        <Bell className="h-4 w-4" aria-hidden="true" />
        {unreadCount > 0 ? (
          <span className="absolute -top-1.5 -right-1.5 grid min-h-[16px] min-w-[16px] place-items-center rounded-full border border-canvas bg-coral px-1 font-mono text-[9px] font-semibold text-canvas">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 mt-2 w-[320px] sm:w-[380px] z-50 border border-coral/40 bg-panel shadow-2xl">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="font-mono text-[11px] uppercase tracking-wider text-coral">Alerts</p>
            <div className="flex items-center gap-2">
              {unreadCount > 0 ? (
                <button
                  type="button"
                  onClick={() => markReadMutation.mutate({ all: true })}
                  className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[10px] uppercase text-gray-300 transition hover:border-coral hover:text-coral"
                >
                  <Check className="h-3 w-3" /> Mark all
                </button>
              ) : null}
              <Link
                href="/alerts"
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 border border-line px-2 py-1 font-mono text-[10px] uppercase text-gray-300 transition hover:border-coral hover:text-coral"
              >
                <SettingsIcon className="h-3 w-3" /> Manage
              </Link>
            </div>
          </div>

          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="p-4 font-mono text-xs text-gray-500">
                No alerts yet. New announcements for stocks in your portfolio will appear here.
              </p>
            ) : (
              items.map((item) => <BellRow key={item.id} item={item} onClose={() => setOpen(false)} onMarkRead={(id) => markReadMutation.mutate({ ids: [id] })} />)
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BellRow({ item, onClose, onMarkRead }: { item: NotificationItem; onClose: () => void; onMarkRead: (id: number) => void }) {
  const unread = !item.readAt;
  return (
    <Link
      href={`/stock?symbol=${encodeURIComponent(item.symbol)}`}
      onClick={() => {
        if (unread) onMarkRead(item.id);
        onClose();
      }}
      className={`block border-b border-line/60 px-4 py-3 transition hover:bg-coral/5 ${unread ? 'bg-coral/5' : ''}`}
    >
      <div className="flex items-center gap-2">
        {unread ? <span className="h-1.5 w-1.5 rounded-full bg-coral" aria-hidden="true" /> : null}
        <span className="font-mono text-[10px] uppercase tracking-wider text-coral">{item.category.replace(/_/g, ' ')}</span>
        <span className="font-mono text-xs font-semibold text-white">{item.symbol}</span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">{formatRelative(item.createdAt)}</span>
      </div>
      <p className="mt-1 font-mono text-xs text-gray-200 leading-snug line-clamp-2">{item.title}</p>
    </Link>
  );
}
