/** Exact counts and stable keys prevent API row caps from masquerading as completion. */
export async function readCompletePages<T extends { id: string }>(
  page: (from: number, to: number) => Promise<{ data: T[] | null; count: number | null; error: unknown }>,
  size = 200
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  while (true) {
    const result = await page(rows.length, rows.length + size - 1);
    if (result.error) throw new Error("complete_read_failed");
    if (!Number.isSafeInteger(result.count) || result.count! < 0 || !Array.isArray(result.data)) {
      throw new Error("complete_read_unverifiable");
    }
    if (expected !== null && expected !== result.count) throw new Error("complete_read_changed");
    expected = result.count;
    for (const row of result.data) {
      if (!row.id || seen.has(row.id)) throw new Error("complete_read_duplicate");
      seen.add(row.id);
      rows.push(row);
    }
    if (rows.length === expected) return rows;
    if (!result.data.length || rows.length > expected!) throw new Error("complete_read_incomplete");
  }
}
