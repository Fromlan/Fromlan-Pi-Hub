import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import * as agentManager from "./agent-manager";
import * as agentsStore from "./agents-store";
import {
  HELPER_DESCRIPTION,
  HELPER_IDENTITY,
  HELPER_NAME,
} from "../shared/default-agents/pi-hub-helper";

/**
 * 首次启动幂等种子 Pi Hub Helper。
 * - 无元数据且无目录 → create + 写 IDENTITY.md
 * - 有孤儿目录无元数据 → 只补 agents.json
 * - 已有 IDENTITY.md → 不覆盖（尊重用户编辑）
 */
export function ensurePiHubHelper(): void {
  const root = join(homedir(), ".pi", "agents", HELPER_NAME);

  if (!agentManager.get(HELPER_NAME)) {
    if (!existsSync(root)) {
      try {
        agentManager.create(HELPER_NAME, HELPER_DESCRIPTION);
      } catch (e) {
        console.error("[guide-agent] create failed:", e);
        return;
      }
    } else {
      const all = agentsStore.loadAgents();
      if (!all.some((a) => a.name === HELPER_NAME)) {
        all.push({
          name: HELPER_NAME,
          description: HELPER_DESCRIPTION,
          createdAt: Date.now(),
        });
        agentsStore.saveAgents(all);
      }
    }
  }

  const identityPath = join(root, "IDENTITY.md");
  if (!existsSync(identityPath)) {
    mkdirSync(root, { recursive: true });
    writeFileSync(identityPath, HELPER_IDENTITY, "utf8");
  }
}

