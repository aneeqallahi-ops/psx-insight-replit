import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';

const DPS_BASE_URL = 'https://dps.psx.com.pk';

export interface IndexConstituent {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
}

function numberFromCell($cell: cheerio.Cheerio<Element>) {
  const raw = $cell.attr('data-order') || $cell.text();
  const value = Number(raw.replace(/,/g, '').replace('%', '').trim());
  return Number.isFinite(value) ? value : 0;
}

export async function getIndexConstituents(code = 'KSE100') {
  const res = await fetch(`${DPS_BASE_URL}/indices/${code}`, {
    headers: {
      Accept: 'text/html',
      'User-Agent': 'PSX-Insight/1.0',
      'X-Requested-With': 'XMLHttpRequest',
    },
  });

  if (!res.ok) throw new Error(`PSX index constituents error: ${res.status}`);

  const $ = cheerio.load(await res.text());
  const rows: IndexConstituent[] = [];

  $('tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    const symbol = cells.eq(0).attr('data-order') || cells.eq(0).find('strong').first().text().trim();

    if (!symbol) return;

    rows.push({
      symbol,
      name: cells.eq(1).text().trim(),
      price: numberFromCell(cells.eq(3)),
      change: numberFromCell(cells.eq(4)),
      changePercent: numberFromCell(cells.eq(5)) / 100,
      volume: numberFromCell(cells.eq(8)),
    });
  });

  return rows;
}
