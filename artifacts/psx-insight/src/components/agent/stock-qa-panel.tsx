import { useEffect, useRef, useState } from 'react';
import { AlertCircle, Send, Sparkles } from 'lucide-react';
import { InputGroup, InputGroupButton, InputGroupInput } from '@/components/ui/input-group';

interface SSEEvent {
  event: string;
  data: unknown;
}

// Same SSE framing parser used by stock-analysis-panel.tsx.
function parseSSEChunk(buffer: string): { events: SSEEvent[]; remainder: string } {
  const events: SSEEvent[] = [];
  let remainder = buffer;
  while (true) {
    const sep = remainder.indexOf('\n\n');
    if (sep < 0) break;
    const block = remainder.slice(0, sep);
    remainder = remainder.slice(sep + 2);
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    if (dataLines.length > 0) {
      try {
        events.push({ event, data: JSON.parse(dataLines.join('\n')) });
      } catch {
        // ignore malformed
      }
    }
  }
  return { events, remainder };
}

interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  asOf?: string;
  isStale?: boolean;
}

const SUGGESTIONS = [
  'What were the high and low today?',
  'What was the total volume traded today?',
  'When did it hit its high?',
  'How long did it trade near its highest price?',
];

function formatAsOf(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Karachi',
  }).format(d);
}

export function StockQaPanel({ symbol }: { symbol: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState<{ text: string; asOf?: string; isStale?: boolean } | null>(null);
  const [input, setInput] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function ask(raw: string) {
    const question = raw.trim();
    if (!question || running) return;

    setError(null);
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setPending({ text: '' });
    setRunning(true);

    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;

    let acc = '';
    let meta: { asOf?: string; isStale?: boolean } = {};

    try {
      const res = await fetch(`/api/stock/ask/${encodeURIComponent(symbol)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, timeframe: '5m' }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      if (!res.body) throw new Error('Streaming not supported by this browser');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const { events, remainder } = parseSSEChunk(buffer);
        buffer = remainder;
        for (const ev of events) {
          if (ev.event === 'meta') {
            const d = ev.data as { asOf?: string; isStale?: boolean };
            meta = { asOf: d.asOf, isStale: d.isStale };
            setPending((p) => ({ text: p?.text ?? '', asOf: d.asOf, isStale: d.isStale }));
          } else if (ev.event === 'token') {
            acc += (ev.data as { text: string }).text;
            setPending((p) => ({ ...(p ?? {}), text: acc }));
          } else if (ev.event === 'error') {
            throw new Error((ev.data as { error: string }).error);
          }
        }
      }

      setMessages((prev) => [...prev, { role: 'assistant', text: acc || '(no answer)', asOf: meta.asOf, isStale: meta.isStale }]);
      setPending(null);
    } catch (err) {
      if ((err as Error).name === 'AbortError') {
        setPending(null);
        return;
      }
      setError(err instanceof Error ? err.message : 'Failed to answer');
      setPending(null);
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="rounded border border-line bg-panel p-6">
      <div className="flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-coral" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-white">Ask about today's price action</h2>
      </div>
      <p className="mt-1 text-sm text-gray-500">
        Ask about {symbol}'s intraday price &amp; volume. Answers use candle data — approximate and possibly delayed. Not investment advice.
      </p>

      {/* Transcript */}
      {(messages.length > 0 || pending) ? (
        <div ref={scrollRef} className="mt-5 flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
          {messages.map((m, i) => (
            <ChatBubble key={i} message={m} />
          ))}
          {pending ? (
            <div className="self-start max-w-[85%] rounded border border-coral/30 bg-coral/5 p-4">
              <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-coral">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Analyst
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-200">
                {pending.text || (running ? 'Thinking…' : '')}
              </p>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-5 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => ask(s)}
              disabled={running}
              className="rounded border border-line bg-black/20 px-3 py-2 text-xs text-gray-300 transition hover:border-coral/60 hover:text-coral disabled:opacity-50"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <div className="mt-4 flex items-start gap-3 rounded border border-rose-400/40 bg-rose-400/10 p-4 text-sm text-rose-100">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-semibold">Couldn't answer</p>
            <p className="mt-1 text-rose-200/80">{error}</p>
          </div>
        </div>
      ) : null}

      {/* Input */}
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
      >
        <InputGroup>
          <InputGroupInput
            value={input}
            onChange={(e) => setInput(e.target.value)}
            maxLength={500}
            placeholder="Ask a question about today's intraday data…"
            disabled={running}
            aria-label="Ask about this stock"
          />
          <InputGroupButton type="submit" size="icon-sm" disabled={running || !input.trim()} aria-label="Send">
            <Send className="h-4 w-4" />
          </InputGroupButton>
        </InputGroup>
      </form>
    </section>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  if (message.role === 'user') {
    return (
      <div className="self-end max-w-[85%] rounded border border-line bg-black/20 p-3 text-sm text-gray-200">
        {message.text}
      </div>
    );
  }
  return (
    <div className="self-start max-w-[85%] rounded border border-coral/30 bg-coral/5 p-4">
      <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-coral">
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" /> Analyst
      </p>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-gray-200">{message.text}</p>
      {message.asOf ? (
        <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
          As of {formatAsOf(message.asOf)} PKT{message.isStale ? ' · prior session' : ''}
        </p>
      ) : null}
    </div>
  );
}
