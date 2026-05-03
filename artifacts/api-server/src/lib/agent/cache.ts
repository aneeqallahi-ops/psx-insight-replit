import { db } from '@workspace/db';
import { agentReports } from '@workspace/db/schema';
import { and, desc, eq, gt, notInArray, sql } from 'drizzle-orm';

export type ReportScope = 'stock' | 'portfolio' | 'market';

export interface CachedReport<T = unknown> {
  payload: T;
  generatedAt: Date;
  expiresAt: Date;
}

export interface StoredReport<T = unknown> extends CachedReport<T> {
  id: number;
}

const HISTORY_LIMIT = 30;

export async function getCachedReport<T = unknown>(
  scope: ReportScope,
  key: string,
): Promise<CachedReport<T> | null> {
  const rows = await db
    .select()
    .from(agentReports)
    .where(
      and(
        eq(agentReports.scope, scope),
        eq(agentReports.key, key),
        gt(agentReports.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(agentReports.generatedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    payload: row.payload as T,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
  };
}

export async function putCachedReport(
  scope: ReportScope,
  key: string,
  payload: unknown,
  ttlMs: number,
  options: { retainGroupKeyPrefix?: string } = {},
): Promise<StoredReport> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs);
  const inserted = await db
    .insert(agentReports)
    .values({ scope, key, payload, generatedAt: now, expiresAt })
    .returning();

  const row = inserted[0];

  // Prune older rows beyond HISTORY_LIMIT for this retention group.
  // - If retainGroupKeyPrefix is provided, the group is (scope, key LIKE prefix%)
  //   so retention spans across daily/rolling sub-keys (e.g. all of "HBL:*").
  // - Otherwise, the group is the exact (scope, key).
  const groupCondition = options.retainGroupKeyPrefix
    ? sql`${agentReports.key} LIKE ${options.retainGroupKeyPrefix + '%'}`
    : eq(agentReports.key, key);

  const keepIds = await db
    .select({ id: agentReports.id })
    .from(agentReports)
    .where(and(eq(agentReports.scope, scope), groupCondition))
    .orderBy(desc(agentReports.generatedAt))
    .limit(HISTORY_LIMIT);

  if (keepIds.length === HISTORY_LIMIT) {
    await db
      .delete(agentReports)
      .where(
        and(
          eq(agentReports.scope, scope),
          groupCondition,
          notInArray(
            agentReports.id,
            keepIds.map((r) => r.id),
          ),
        ),
      );
  }

  return {
    id: row.id,
    payload: row.payload,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
  };
}

export async function getLatestReport<T = unknown>(
  scope: ReportScope,
  key: string,
): Promise<CachedReport<T> | null> {
  const rows = await db
    .select()
    .from(agentReports)
    .where(and(eq(agentReports.scope, scope), eq(agentReports.key, key)))
    .orderBy(desc(agentReports.generatedAt))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    payload: row.payload as T,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
  };
}

export async function listReports(
  scope: ReportScope,
  keyPrefix: string,
  limit = HISTORY_LIMIT,
): Promise<StoredReport[]> {
  const rows = await db
    .select()
    .from(agentReports)
    .where(
      and(
        eq(agentReports.scope, scope),
        sql`${agentReports.key} LIKE ${keyPrefix + '%'}`,
      ),
    )
    .orderBy(desc(agentReports.generatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    payload: row.payload,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
  }));
}

export async function getReportById<T = unknown>(
  scope: ReportScope,
  id: number,
  keyPrefix?: string,
): Promise<StoredReport<T> | null> {
  const conditions = [eq(agentReports.scope, scope), eq(agentReports.id, id)];
  if (keyPrefix !== undefined) {
    conditions.push(sql`${agentReports.key} LIKE ${keyPrefix + '%'}`);
  }
  const rows = await db
    .select()
    .from(agentReports)
    .where(and(...conditions))
    .limit(1);

  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id,
    payload: row.payload as T,
    generatedAt: row.generatedAt,
    expiresAt: row.expiresAt,
  };
}

