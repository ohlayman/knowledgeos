import { Prisma, type PrismaClient } from '@kos/database';
import type { ChunkRow, RetrievalOptions } from './types.js';

interface KeywordRow {
  chunkId: string;
  documentId: string;
  versionId: string;
  text: string;
  headingPath: string[];
  pageStart: number | null;
  pageEnd: number | null;
  tokenCount: number;
  rank: number;
}

export async function keywordSearch(
  prisma: PrismaClient,
  tsQuery: string,
  options: RetrievalOptions,
): Promise<ChunkRow[]> {
  if (!tsQuery) {
    return [];
  }

  const conditions: Prisma.Sql[] = [
    Prisma.sql`c.search_vector @@ to_tsquery('simple', ${tsQuery})`,
    Prisma.sql`d.is_deleted = false`,
  ];
  if (!options.includeHistoryVersions) {
    conditions.push(Prisma.sql`v.is_current = true`);
  }
  if (options.documentIds?.length) {
    conditions.push(Prisma.sql`c.document_id = ANY(${options.documentIds}::uuid[])`);
  }
  if (options.tags?.length) {
    conditions.push(Prisma.sql`d.tags && ${options.tags}::text[]`);
  }

  const rows = await prisma.$queryRaw<KeywordRow[]>(Prisma.sql`
    SELECT c.id AS "chunkId",
           c.document_id AS "documentId",
           c.version_id AS "versionId",
           c.text,
           c.heading_path AS "headingPath",
           c.page_start AS "pageStart",
           c.page_end AS "pageEnd",
           c.token_count AS "tokenCount",
           ts_rank_cd(c.search_vector, to_tsquery('simple', ${tsQuery})) AS rank
    FROM chunks c
    JOIN document_versions v ON v.id = c.version_id
    JOIN documents d ON d.id = c.document_id
    WHERE ${Prisma.join(conditions, ' AND ')}
    ORDER BY rank DESC, c.id ASC
    LIMIT ${options.keywordTopN ?? 40}
  `);

  return rows.map((row) => ({ ...row, keywordScore: row.rank }));
}
