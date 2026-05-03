import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import { MarketDashboard } from "@/pages/market-dashboard";
import { MarketsPage } from "@/pages/markets-page";
import { StockPage } from "@/pages/stock-page";
import { PortfolioPage } from "@/pages/portfolio-page";
import { NewsPage } from "@/pages/news-page";
import { AnalysisPage } from "@/pages/analysis-page";
import { EventsPage } from "@/pages/events-page";
import { AlertsPage } from "@/pages/alerts-page";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5_000,
    },
  },
});

function Router() {
  return (
    <AppShell>
      <Switch>
        <Route path="/" component={MarketDashboard} />
        <Route path="/markets" component={MarketsPage} />
        <Route path="/stock" component={StockPage} />
        <Route path="/watchlist" component={PortfolioPage} />
        <Route path="/news" component={NewsPage} />
        <Route path="/analysis" component={AnalysisPage} />
        <Route path="/events" component={EventsPage} />
        <Route path="/alerts" component={AlertsPage} />
        <Route>
          <div className="grid min-h-screen place-items-center bg-canvas text-gray-100">
            <div className="text-center">
              <p className="text-sm font-medium uppercase text-coral">PSX Insight</p>
              <h1 className="mt-4 text-4xl font-semibold text-white">Page not found</h1>
              <p className="mt-4 text-sm text-gray-400">This page does not exist.</p>
              <a href="/" className="mt-8 inline-block rounded border border-coral/60 bg-coral/15 px-5 py-3 text-sm font-semibold text-coral transition hover:bg-coral/25">Go to Dashboard</a>
            </div>
          </div>
        </Route>
      </Switch>
    </AppShell>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </QueryClientProvider>
  );
}

export default App;
