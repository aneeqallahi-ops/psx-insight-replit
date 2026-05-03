import { anthropic } from '@workspace/integrations-anthropic-ai';
import pRetry from 'p-retry';
import { logger } from '../logger';

const MODEL = 'claude-sonnet-4-6';
const MAX_TOKENS = 8192;
const REQUEST_TIMEOUT_MS = 60_000;
const MAX_CALLS_PER_MINUTE = 10;

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
}

export async function analyze(prompt: string, options: AnalyzeOptions = {}): Promise<string> {
  checkRateLimit();
  const start = Date.now();

  const result = await pRetry(
    async () => {
      const message = await withTimeout(
        anthropic.messages.create({
          model: MODEL,
          max_tokens: options.maxTokens ?? MAX_TOKENS,
          system: options.system,
          messages: [{ role: 'user', content: prompt }],
        }),
        REQUEST_TIMEOUT_MS,
        'Anthropic messages.create',
      );

      const block = message.content.find((b) => b.type === 'text');
      const text = block && block.type === 'text' ? block.text : '';

      logger.info(
        {
          inputTokens: message.usage?.input_tokens,
          outputTokens: message.usage?.output_tokens,
          durationMs: Date.now() - start,
        },
        'LLM analyze call complete',
      );

      return text;
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
  checkRateLimit();
  const start = Date.now();

  const result = await pRetry(
    async () => {
      const stream = anthropic.messages.stream({
        model: MODEL,
        max_tokens: options.maxTokens ?? MAX_TOKENS,
        system: options.system,
        messages: [{ role: 'user', content: prompt }],
      });

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
      let finalUsage: { input_tokens?: number; output_tokens?: number } | undefined;

      try {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            full += event.delta.text;
            options.onToken?.(event.delta.text);
          } else if (event.type === 'message_delta' && event.usage) {
            finalUsage = { output_tokens: event.usage.output_tokens };
          } else if (event.type === 'message_start' && event.message.usage) {
            finalUsage = { ...finalUsage, input_tokens: event.message.usage.input_tokens };
          }
        }
      } catch (err) {
        if (Date.now() - startedAt >= REQUEST_TIMEOUT_MS) {
          throw new Error(`Anthropic messages.stream timed out after ${REQUEST_TIMEOUT_MS}ms`);
        }
        throw err;
      } finally {
        clearTimeout(timer);
      }

      logger.info(
        {
          inputTokens: finalUsage?.input_tokens,
          outputTokens: finalUsage?.output_tokens,
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
