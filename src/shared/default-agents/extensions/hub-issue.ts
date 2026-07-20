/**
 * Hub Issue 工具扩展模板（文档 / 对照用）。
 * 运行时由主进程 hub-issue-extension.ts 写入 userData 并经 `--extension` 注入。
 * 修改工具时请同步更新 src/main/hub-issue-extension.ts 内嵌源码。
 */

import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

function env(name: string): string {
  return (process.env[name] ?? "").trim();
}

async function hubPost(
  path: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const base = env("FROMLAN_HUB_BRIDGE_URL");
  const key = env("FROMLAN_HUB_BRIDGE_KEY");
  const hubSessionId = env("FROMLAN_HUB_SESSION_ID");
  if (!base || !key || !hubSessionId) {
    throw new Error(
      "Hub 桥未配置（缺少 FROMLAN_HUB_BRIDGE_URL / KEY / SESSION_ID）"
    );
  }
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ ...body, hubSessionId }),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Hub bridge HTTP ${res.status}`);
  }
  return data;
}

function textResult(text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: {},
  };
}

export default function (pi: ExtensionAPI): void {
  if (!pi?.registerTool) return;

  pi.registerTool({
    name: "hub_set_status",
    label: "Hub Set Status",
    description:
      "设置当前 Issue 的状态（todo / in_progress / in_review / done / blocked / cancelled / backlog）。阻塞时优先用 hub_report_blocker。",
    parameters: Type.Object({
      status: Type.String({
        description:
          "Issue 状态：backlog|todo|in_progress|in_review|done|blocked|cancelled",
      }),
    }),
    async execute(_id, params) {
      const data = (await hubPost("/v1/issue/status", {
        status: params.status,
      })) as { issue?: { key?: string; status?: string } };
      return textResult(
        `已将 Issue ${data.issue?.key ?? ""} 设为 ${params.status}`
      );
    },
  });

  pi.registerTool({
    name: "hub_report_blocker",
    label: "Hub Report Blocker",
    description:
      "将当前 Issue 标为 blocked，并写一条阻塞说明评论。遇到无法自行解决的阻碍时调用。",
    parameters: Type.Object({
      reason: Type.String({ description: "阻塞原因与建议下一步" }),
    }),
    async execute(_id, params) {
      await hubPost("/v1/issue/blocker", { reason: params.reason });
      return textResult(`已报告阻塞：${params.reason}`);
    },
  });

  pi.registerTool({
    name: "hub_create_issue",
    label: "Hub Create Issue",
    description:
      "在看板创建新 Issue（默认作为当前 Issue 的子任务）。用于拆分子工作。",
    parameters: Type.Object({
      title: Type.String({ description: "Issue 标题" }),
      description: Type.Optional(Type.String({ description: "描述" })),
      priority: Type.Optional(
        Type.String({ description: "urgent|high|medium|low" })
      ),
    }),
    async execute(_id, params) {
      const data = (await hubPost("/v1/issue/create", {
        title: params.title,
        description: params.description,
        priority: params.priority,
        parent: true,
      })) as { issue?: { key?: string; title?: string } };
      return textResult(
        `已创建 ${data.issue?.key ?? "Issue"}: ${data.issue?.title ?? params.title}`
      );
    },
  });

  pi.registerTool({
    name: "hub_add_comment",
    label: "Hub Add Comment",
    description:
      "向当前 Issue 追加一条评论（进度说明）。最终摘要仍会在结束时自动写回。",
    parameters: Type.Object({
      body: Type.String({ description: "评论正文" }),
    }),
    async execute(_id, params) {
      await hubPost("/v1/issue/comment", { body: params.body });
      return textResult("评论已写入 Issue");
    },
  });
}
