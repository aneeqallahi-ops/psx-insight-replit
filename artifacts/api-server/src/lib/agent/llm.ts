import { anthropic } from '@workspace/integrations-anthropic-ai';
import pRetry, { AbortError } from 'p-retry';
import { logger } from '../logger';

const MODEL = 'claude-sonnet-4-6';
// Cheap, fast model for the three analyst legs (technical, fundamental, news).
// Each leg consumes structured prompts and emits a small fixed-shape JSON; that
// is squarely in Haiku's wheelhouse and roughly halves cost vs. Sonnet.
// The synthesizer keeps the default Sonnet model because it must weigh three
// signals and write nuanced rationale.
export const ANALYST_MODEL = 'claude-haiku-4-5-20251001';
const MAX_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CALLS_PER_MINUTE = 10;

// Anthropic caches a system block when ≥1024 tokens (Sonnet). Marking shorter
// prompts is harmless — the API silently skips caching below the threshold.
function buildSystem(text: string | undefined) {
  if (!text) return undefined;
  return [
    { type: 'text' as const, text, cache_control: { type: 'ephemeral' as const } },
  ];
}

function isAbortError(err: unknown): boolean {
  if (!err || !(err instanceof Error)) return false;
  if (err.name === 'AbortError') return true;
  const code = (err as unknown as { code?: unknown }).code;
  return typeof code === 'string' && code === 'ABORT_ERR';
}

const callTimestamps: number[] = [];

function checkRateLimit() {
  const cutoff = Date.now() - 60_000;
  while (callTimestamps.length > 0 && callTimestamps[0] < cutoff) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= MAX_CALLS_PER_MINUTE) {
    const oldest = callTimestamps[0];
    const waitMs = 60_000 - (Date.now() - oldest);
    throw new Error(
      `LLM rate limit hit (${MAX_CALLS_PER_MINUTE}/min). Try again in ${Math.ceil(waitMs / 1000)}s.`,
    );
  }
  callTimestamps.push(Date.now());
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export interface AnalyzeOptions {
  system?: string;
  maxTokens?: number;
  signal?: AbortSignal;
  model?: string;
}

export async function analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
  if (options.signal?.aborted) throw new AbortError('Aborted before LLM call');
  checkRateLimit();
  const start = Date.now();

  const result = await pRetry(
    async () => {
      if (options.signal?.aborted) throw new AbortError('Aborted before retry');
      try {
        const message = await withTimeout(
          anthropic.messages.create(
            {
              model: options.model ?? MODEL,
              max_tokens: options.maxTokens ?? MAX_TOKENS,
              system: buildSystem(options.system),
              messages: [{ role: 'user', content: prompt }],
            },
            { signal: options.signal },
          ),
          REQUEST_TIMEOUT_MS,
          'Anthropic messages.create',
        );

        const block = message.content.find((b) => b.type === 'text');
        const text = block && block.type === 'text' ? block.text : '';

        logger.info(
          {
            inputTokens: message.usage?.input_tokens,
            outputTokens: message.usage?.output_tokens,
            cacheCreationInputTokens: message.usage?.cache_creation_input_tokens,
            cacheReadInputTokens: message.usage?.cache_read_input_tokens,
            durationMs: Date.now() - start,
          },
          'LLM analyze call complete',
        );

        return text;
      } catch (err) {
        if (isAbortError(err)) throw new AbortError(err instanceof Error ? err.message : 'Aborted');
        throw err;
      }
    },
    { retries: 5, minTimeout: 1000, maxTimeout: 30_000, factor: 2 },
  );

  return result;
}

export interface AnalyzeStreamOptions extends AnalyzeOptions {
  onToken?: (token: string) => void;
}

export async function analyzeStream(
  prompt: string,
  options: AnalyzeStreamOptions = {},
): Promise<string> {
  if (options.signal?.aborted) throw new AbortError('Aborted before LLM call');
  checkRateLimit();
  const start = Date.now();

  const result = await pRetry(
    async () => {
      if (options.signal?.aborted) throw new AbortError('Aborted before retry');

      const stream = anthropic.messages.stream({
        model: options.model ?? MODEL,
        max_tokens: options.maxTokens ?? MAX_TOKENS,
        system: buildSystem(options.system),
        messages: [{ role: 'user', content: prompt }],
      });

      // Forward an external abort (e.g. SSE client disconnect) to the stream.
      let externallyAborted = false;
      const onExternalAbort = () => {
        externallyAborted = true;
        try {
          stream.controller.abort();
        } catch {
          // best-effort abort
        }
      };
      options.signal?.addEventListener('abort', onExternalAbort, { once: true });

      // Hard 60s ceiling on the entire stream read; abort upstream on timeout.
      const timer = setTimeout(() => {
        try {
          stream.controller.abort();
        } catch {
          // best-effort abort
        }
      }, REQUEST_TIMEOUT_MS);
      const startedAt = Date.now();

      let full = '';
      let finalUsage:
        | {
            input_tokens?: number;
            output_tokens?: number;
            cache_creation_input_tokens?: number;
            cache_read_input_tokens?: number;
          }
        | undefined;

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            full += event.delta.text;
            options.onToken?.(event.delta.text);
          } else if (event.type === 'message_delta' && event.usage) {
            finalUsage = { ...finalUsage, output_tokens: event.usage.output_tokens };
          } else if (event.type === 'message_start' && event.message.usage) {
            const u = event.message.usage;
            finalUsage = {
              ...finalUsage,
              input_tokens: u.input_tokens,
              cache_creation_input_tokens: u.cache_creation_input_tokens ?? undefined,
              cache_read_input_tokens: u.cache_read_input_tokens ?? undefined,
            };
          }
        }
      } catch (err) {
        if (externallyAborted || isAbortError(err)) {
          throw new AbortError('Stream aborted by client');
        }
        if (Date.now() - startedAt >= REQUEST_TIMEOUT_MS) {
          throw new Error(`Anthropic messages.stream timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener('abort', onExternalAbort);
      }

      logger.info(
        {
          inputTokens: finalUsage?.input_tokens,
          outputTokens: finalUsage?.output_tokens,
          cacheCreationInputTokens: finalUsage?.cache_creation_input_tokens,
          cacheReadInputTokens: finalUsage?.cache_read_input_tokens,
          durationMs: Date.now() - start,
        },
        'LLM analyzeStream call complete',
      );

      return full;
    },
    { retries: 5, minTimeout: 1000, maxTimeout: 30_000, factor: 2 },
  );

  return result;
}

export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const trimmed = candidate.trim();

  // Find first { and last } for safety against preamble/postamble
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  const jsonStr = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;

  try {
    return JSON.parse(jsonStr) as T;
  } catch (err) {
    throw new Error(`LLM did not return valid JSON: ${err instanceof Error ? err.message : err}`);
  }
}
