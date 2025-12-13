export type HistoryKind = "image" | "video";

export type HistoryRow = {
  id: string;
  user_key: string;
  kind: HistoryKind;
  prompt: string;
  created_at: number;
  r2_key: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  extra_json: string | null;
};

export async function insertHistory(
  db: D1Database,
  row: Omit<HistoryRow, "width" | "height" | "extra_json"> & {
    width?: number | null;
    height?: number | null;
    extra_json?: string | null;
  }
): Promise<void> {
  const {
    id,
    user_key,
    kind,
    prompt,
    created_at,
    r2_key,
    mime_type,
    width = null,
    height = null,
    extra_json = null,
  } = row;

  await db
    .prepare(
      `INSERT INTO history (id, user_key, kind, prompt, created_at, r2_key, mime_type, width, height, extra_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, user_key, kind, prompt, created_at, r2_key, mime_type, width, height, extra_json)
    .run();
}

export async function getHistoryById(db: D1Database, id: string): Promise<HistoryRow | null> {
  const res = await db.prepare(`SELECT * FROM history WHERE id = ?`).bind(id).first<HistoryRow>();
  return res ?? null;
}

export async function deleteHistoryById(db: D1Database, id: string): Promise<HistoryRow | null> {
  const row = await getHistoryById(db, id);
  if (!row) return null;
  await db.prepare(`DELETE FROM history WHERE id = ?`).bind(id).run();
  return row;
}

export type HistoryListPage = {
  items: HistoryRow[];
  nextCursor: string | null;
};

// Cursor format: `${created_at}:${id}` (both DESC)
export async function listHistory(
  db: D1Database,
  userKey: string,
  limit: number,
  cursor?: string | null
): Promise<HistoryListPage> {
  const safeLimit = Math.max(1, Math.min(50, limit));

  let createdAtCursor: number | null = null;
  let idCursor: string | null = null;
  if (cursor) {
    const [ts, id] = cursor.split(":");
    const parsed = Number(ts);
    if (Number.isFinite(parsed) && id) {
      createdAtCursor = parsed;
      idCursor = id;
    }
  }

  const stmt = cursor && createdAtCursor !== null && idCursor
    ? db.prepare(
        `SELECT * FROM history
         WHERE user_key = ?
           AND (created_at < ? OR (created_at = ? AND id < ?))
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      ).bind(userKey, createdAtCursor, createdAtCursor, idCursor, safeLimit + 1)
    : db.prepare(
        `SELECT * FROM history
         WHERE user_key = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      ).bind(userKey, safeLimit + 1);

  const res = await stmt.all<HistoryRow>();
  const rows = (res.results ?? []) as HistoryRow[];
  const hasMore = rows.length > safeLimit;
  const items = rows.slice(0, safeLimit);
  const last = items[items.length - 1];
  const nextCursor = hasMore && last ? `${last.created_at}:${last.id}` : null;

  return { items, nextCursor };
}


