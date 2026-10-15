export type LegalBlock =
  | { content: string; type: "paragraph" }
  | { items: string[]; type: "list" }
  | { content: string; level: 1 | 2 | 3; type: "heading" };

export function parseLegalDocument(content: string): LegalBlock[] {
  const lines = content.trim().split("\n");
  const blocks: LegalBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        content: heading[2],
        level: heading[1].length as 1 | 2 | 3,
        type: "heading"
      });
      index += 1;
      continue;
    }

    if (line.startsWith("- ")) {
      const items: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith("- ")) {
        items.push(lines[index].trim().slice(2));
        index += 1;
      }
      blocks.push({ items, type: "list" });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const next = lines[index].trim();
      if (!next || /^(#{1,3})\s+/.test(next) || next.startsWith("- ")) break;
      paragraph.push(next);
      index += 1;
    }
    blocks.push({ content: paragraph.join(" "), type: "paragraph" });
  }

  return blocks;
}
