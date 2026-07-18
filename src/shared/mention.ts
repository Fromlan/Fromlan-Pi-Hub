import type { AssigneeKind } from "./types";

/**
 * Mention 协议：`[@Display](mention://agent/<id>)` / `mention://squad/<id>` / `mention://human/<id>`
 * 对齐 Multica 的 markdown mention 形式，便于解析与注入。
 */

export interface ParsedMention {
  kind: AssigneeKind;
  id: string;
  display: string;
  /** 原文中的完整 markdown 片段。 */
  raw: string;
}

const MENTION_RE =
  /\[@([^\]]+)\]\(mention:\/\/(agent|squad|human)\/([^)]+)\)/g;

/** 生成 mention markdown。 */
export function formatMention(
  kind: AssigneeKind,
  id: string,
  display?: string
): string {
  const label = display || id;
  return `[@${label}](mention://${kind}/${id})`;
}

/** 从文本中解析全部 mention。 */
export function parseMentions(text: string): ParsedMention[] {
  if (!text) return [];
  const out: ParsedMention[] = [];
  const re = new RegExp(MENTION_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push({
      display: m[1],
      kind: m[2] as AssigneeKind,
      id: m[3],
      raw: m[0],
    });
  }
  return out;
}

/** 去重后的 mention 列表（按 kind+id）。 */
export function uniqueMentions(text: string): ParsedMention[] {
  const seen = new Set<string>();
  const out: ParsedMention[] = [];
  for (const m of parseMentions(text)) {
    const key = `${m.kind}:${m.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}
