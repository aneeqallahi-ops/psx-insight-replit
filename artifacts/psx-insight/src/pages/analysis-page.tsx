import { DailyReportView } from '@/components/agent/daily-report-view';

export function AnalysisPage() {
  return (
    <main className="min-h-[calc(100vh-120px)] px-4 py-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
        <header className="flex flex-col gap-3 border-b border-line pb-6">
          <div className="flex items-center gap-3">
            <span className="font-mono text-[10px] text-coral tracking-widest">006 // ANALYSIS</span>
            <span className="flex-1 h-px bg-coral/20" />
          </div>
          <h1 className="font-display text-4xl tracking-wide text-white lg:text-6xl">MARKET ANALYSIS</h1>
          <p className="max-w-3xl font-mono text-xs uppercase tracking-wider leading-relaxed text-gray-500">
            // DAILY AI-GENERATED DESK BRIEFING · BREADTH · SECTOR ROTATION · MOVERS · MACRO CONTEXT
          </p>
        </header>
        <DailyReportView />
      </div>
    </main>
  );
}
