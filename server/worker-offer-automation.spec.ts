import { describe, expect, it } from 'vitest';
import worker from './worker.js';
import { getCurrentCoopWeekCode, getIsoWeekRange } from './coop-offer-automation.js';

const token = 'a'.repeat(48);
const categories = [
  'Bröd & bageri',
  'Deli & chark',
  'Frukt & grönt',
  'Frysvaror',
  'Fågel, fisk & kött',
  'Godis & snacks',
  'Hem & fritid',
  'Kaffe & dryck',
  'Mejeri & ägg',
  'Skafferi',
];

function payload() {
  const weekCode = getCurrentCoopWeekCode();
  const period = getIsoWeekRange(weekCode);
  const categoryCounts = categories.map((name) => ({ name, count: 2 }));
  const cards = categoryCounts.flatMap(({ name }, categoryIndex) =>
    Array.from({ length: 2 }, (_, itemIndex) => {
      const productName = `Product ${categoryIndex * 2 + itemIndex + 1}`;
      return {
        productName,
        sourceCategory: name,
        text: `${productName}\n69,90 kronor\n500 g`,
      };
    }),
  );
  return {
    storeId: 'coop-lund',
    storeName: 'Stora Coop Lund',
    storePageUrl: 'https://www.coop.se/butiker-erbjudanden/stora-coop/stora-coop-lund/',
    flyerUrl: `https://dr.coop.se/Butik/Stora-Coop-Lund?c=${weekCode}`,
    weekCode,
    expectedOfferCount: cards.length,
    categoryCounts,
    pdfEvidence: {
      isPdf: true,
      storeMatch: true,
      byteLength: 80_000,
      pageCount: 12,
      sha256: 'b'.repeat(64),
      validityPeriod: period,
    },
    cards,
  };
}

function request(path: string, body: unknown, authorization = `Bearer ${token}`) {
  return new Request(`https://app.example${path}`, {
    method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

class MockStatement {
  private values: unknown[] = [];

  constructor(
    private readonly database: MockDatabase,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]) {
    this.values = values;
    return this;
  }

  async first() {
    if (this.sql.includes('FROM offer_publications')) {
      return this.database.publications.get(String(this.values[0])) ?? null;
    }
    return null;
  }

  async run() {
    if (this.sql.includes('INSERT INTO offer_import_runs')) this.database.runs.push(this.values);
    if (this.sql.includes('INSERT INTO offer_publications')) {
      const [storeId, sourceHash, catalogJson, publishedAt] = this.values;
      this.database.publications.set(String(storeId), {
        source_hash: sourceHash,
        catalog_json: catalogJson,
        published_at: publishedAt,
      });
    }
    return { meta: { changes: 1 } };
  }
}

class MockDatabase {
  publications = new Map<
    string,
    { source_hash: unknown; catalog_json: unknown; published_at: unknown }
  >();
  runs: unknown[][] = [];

  prepare(sql: string) {
    return new MockStatement(this, sql);
  }

  async batch(statements: MockStatement[]) {
    for (const statement of statements) await statement.run();
    return [];
  }
}

describe('automated offer publishing endpoint', () => {
  it('requires its dedicated token without creating or changing data', async () => {
    const DB = new MockDatabase();
    const response = await worker.fetch(
      request('/api/offers/automated-publish', payload(), 'Bearer wrong'),
      {
        DB,
        OFFER_AUTOMATION_TOKEN: token,
      } as never,
    );

    expect(response.status).toBe(401);
    expect(DB.runs).toHaveLength(0);
    expect(DB.publications.size).toBe(0);
  });

  it('rejects incomplete price data and preserves the previous publication', async () => {
    const DB = new MockDatabase();
    DB.publications.set('coop-lund', {
      source_hash: 'old',
      catalog_json: '{"offers":[]}',
      published_at: 123,
    });
    const invalidPayload = payload();
    invalidPayload.cards[0].text = 'Product 1\nErbjudande\nSe pris i butik';
    const response = await worker.fetch(request('/api/offers/automated-publish', invalidPayload), {
      DB,
      OFFER_AUTOMATION_TOKEN: token,
    } as never);

    expect(response.status).toBe(422);
    expect(DB.publications.get('coop-lund')?.source_hash).toBe('old');
    expect(DB.runs).toHaveLength(0);
  });

  it('publishes atomically and treats an identical rerun as idempotent', async () => {
    const DB = new MockDatabase();
    const env = { DB, OFFER_AUTOMATION_TOKEN: token } as never;
    const body = payload();
    const first = await worker.fetch(request('/api/offers/automated-publish', body), env);
    const firstResult = (await first.json()) as { alreadyPublished: boolean; publishedAt: number };
    const publishedAt = DB.publications.get('coop-lund')?.published_at;
    const second = await worker.fetch(request('/api/offers/automated-publish', body), env);
    const secondResult = (await second.json()) as {
      alreadyPublished: boolean;
      publishedAt: number;
    };

    expect(first.status).toBe(200);
    expect(firstResult.alreadyPublished).toBe(false);
    expect(second.status).toBe(200);
    expect(secondResult.alreadyPublished).toBe(true);
    expect(secondResult.publishedAt).toBe(publishedAt);
    expect(DB.publications.get('coop-lund')?.published_at).toBe(publishedAt);
    expect(DB.runs).toHaveLength(2);
  });

  it('records a failed run without touching the previous catalog', async () => {
    const DB = new MockDatabase();
    DB.publications.set('coop-lund', {
      source_hash: 'old',
      catalog_json: '{"offers":[]}',
      published_at: 123,
    });
    const response = await worker.fetch(
      request('/api/offers/automated-failure', {
        storeId: 'coop-lund',
        weekCode: getCurrentCoopWeekCode(),
      }),
      { DB, OFFER_AUTOMATION_TOKEN: token } as never,
    );

    expect(response.status).toBe(200);
    expect(DB.runs).toHaveLength(1);
    expect(DB.publications.get('coop-lund')?.source_hash).toBe('old');
  });
});
