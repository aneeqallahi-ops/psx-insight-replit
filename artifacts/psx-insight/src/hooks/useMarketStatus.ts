import { useQuery } from '@tanstack/react-query';

interface MarketStatusResponse {
  status: string;
  timestamp: number;
  isOpen: boolean;
  label: string;
  updatedAt: number;
}

async function fetchMarketStatus(): Promise<MarketStatusResponse> {
  const res = await fetch('/api/market/status', { cache: 'no-store' });
  if (!res.ok) {
    const payload = await res.json().catch(() => null);
    throw new Error(payload?.error || 'Unable to load market status');
  }
  return res.json();
}

export function useMarketStatus() {
  return useQuery({
    queryKey: ['market-status'],
    queryFn: fetchMarketStatus,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
