import { spawn, spawnSync, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { existsSync, readdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

/** stdout 累积缓冲上限，防止故障子进程刷屏导致主进程 OOM。 */
const MAX_BUFFER = 64 * 1024 * 1024;
/** send() 默认超时，避免挂死的 pi 让 get_state / getModels 永久 pending。 */
const DEFAULT_SEND_TIMEOUT_MS = 30_000;
/** close()：stdin EOF 后等 exit 的宽限；超时则 kill。 */
const CLOSE_KILL_MS = 5_000;
/** close()：绝对上限——即使 kill 后仍无 exit/close，也必须 finalize。 */
const CLOSE_HARD_TIMEOUT_MS = 8_000;

export interface PiRpcClientOptions {
  provider: string;
  model: string;
  cwd?: string;
  noSession?: boolean;
  sessionId?: string;
  env?: Record<string, string>;
  /**
   * 绑定的 agent 名称。设值后：
   * - 自动追加 --no-extensions / --no-skills / --no-prompt-templates / --no-context-files
   *   关闭全局与项目级发现，让 pi 子进程看不到 ~/.pi/agent/ 与 .pi/* 的内容；
   * - 再显式注入 ~/.pi/agents/<name>/{prompts,skills,extensions}/ 下的文件。
   * 留空则沿用 pi 默认行为（加载全局 + 当前 cwd 下的项目级）。
   */
  agentName?: string;
  /** 额外 `--extension` 绝对路径（如 Hub Issue 工具），在 agent 隔离注入之后追加。 */
  extraExtensions?: string[];
}

interface ResolvedPi {
  cmd: string;
  useShell: boolean;
}

interface PendingWaiter {
  resolve: (data: unknown) => void;
  reject: (err: Error) => void;
}

/**
 * shell:true 时（Windows .cmd/.bat），用户可控参数若含 cmd 元字符会被注入。
 * spawn 前拒绝危险字符；.exe + shell:false 路径不受影响。
 */
const SHELL_UNSAFE = /[\r\n&|<>^%!"]/;
function assertShellSafe(value: string | undefined, label: string): void {
  if (value == null || value === "") return;
  if (SHELL_UNSAFE.test(value)) {
    throw new Error(`不安全的 ${label}（含 shell 元字符）`);
  }
}

/**
 * 解析 pi 可执行文件路径与启动模式（缓存一次）。
 *
 * Windows：`where pi` 通常返回多行——无扩展名的 shell 脚本、`pi.cmd`、`pi.exe` 等。
 * - `.exe` 可以 shell:false 直接执行（最安全，杜绝命令注入）；
 * - `.cmd` / `.bat` 必须经 cmd.exe 解释，只能 shell:true；
 * - 无扩展名文件用 shell:false 直接 spawn 会 ENOENT。
 * 因此优先选 .exe（shell:false），否则退回 .cmd/.bat（shell:true）。
 * 非 Windows：which 结果直接 shell:false。
 * 全部失败：回退裸 "pi" + shell:true（启动时仍会做参数消毒）。
 */
let resolvedPi: ResolvedPi | undefined;
function resolvePi(): ResolvedPi {
  if (resolvedPi !== undefined) return resolvedPi;
  const isWin = process.platform === "win32";
  const finder = isWin ? "where" : "which";
  try {
    const out = spawnSync(finder, ["pi"], { encoding: "utf8" });
    const lines = (out.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s && existsSync(s));
    if (isWin) {
      const exe = lines.find((l) => /\.exe$/i.test(l));
      if (exe) {
        resolvedPi = { cmd: exe, useShell: false };
        return resolvedPi;
      }
      const cmd = lines.find((l) => /\.(cmd|bat)$/i.test(l));
      if (cmd) {
        resolvedPi = { cmd, useShell: true };
        return resolvedPi;
      }
    } else if (lines[0]) {
      resolvedPi = { cmd: lines[0], useShell: false };
      return resolvedPi;
    }
  } catch {
    // fallthrough
  }
  resolvedPi = { cmd: "pi", useShell: true };
  return resolvedPi;
}

/**
 * 单个 pi --mode rpc 子进程的封装。
 *
 * 通过 stdin/stdout 收发 JSONL：
 * - 命令带 id -> request/response（send 返回 Promise）
 * - 无 id 的流式命令用 sendFireAndForget
 * - 事件（无 id）通过 emit("event") 与 emit(type) 推给上层
 */
export class PiRpcClient extends EventEmitter {
  private child: ChildProcess | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private pending = new Map<string, PendingWaiter>();
  private closed = true;
  private closePromise: Promise<void> | null = null;
  private _pid?: number;

  constructor(private opts: PiRpcClientOptions) {
    super();
    this.spawn();
  }

  private spawn(): void {
    const args = [
      "--mode",
      "rpc",
      "--provider",
      this.opts.provider,
      "--model",
      this.opts.model,
    ];
    if (this.opts.noSession) args.push("--no-session");
    if (this.opts.sessionId) args.push("--session", this.opts.sessionId);
    // 禁掉主题/色彩，便于纯 JSONL 解析
    args.push("--no-themes");

    // agent 隔离：关闭全局与项目级发现，再显式注入 agent 自己的 prompts/skills/extensions。
    // 注意：必须在子进程 spawn 前同步完成（spawn() 非 async），所以用 readdirSync。
    if (this.opts.agentName) {
      // 校验 agentName 格式，防止通过构造特殊名称遍历任意目录
      if (!/^[a-z0-9][a-z0-9-]*$/.test(this.opts.agentName) || this.opts.agentName.length > 32) {
        throw new Error(`无效 agent 名称: ${this.opts.agentName}`);
      }
      const root = join(homedir(), ".pi", "agents", this.opts.agentName);
      args.push(
        "--no-extensions",
        "--no-skills",
        "--no-prompt-templates",
        "--no-context-files"
      );
      const pushDir = (
        subdir: "prompts" | "skills" | "extensions",
        flag: "--prompt-template" | "--skill" | "--extension",
        accept: (entryName: string) => boolean
      ): void => {
        const dir = join(root, subdir);
        let entries: string[];
        try {
          entries = readdirSync(dir);
        } catch {
          return;
        }
        for (const entry of entries) {
          if (!accept(entry)) continue;
          args.push(flag, join(dir, entry));
        }
      };
      pushDir("prompts", "--prompt-template", (n) => n.endsWith(".md"));
      pushDir("skills", "--skill", () => true);
      pushDir("extensions", "--extension", (n) => n.endsWith(".ts"));
      // 对齐 Multica Agent Identity：agent 根目录 IDENTITY.md → 追加到系统提示
      const identityPath = join(root, "IDENTITY.md");
      if (existsSync(identityPath)) {
        args.push("--append-system-prompt", identityPath);
      }
    }

    // Hub 等额外 extension（在 agent 隔离之后仍可注入）
    if (this.opts.extraExtensions?.length) {
      for (const ext of this.opts.extraExtensions) {
        if (ext && existsSync(ext)) {
          args.push("--extension", ext);
        }
      }
    }

    // env 严格白名单：不再透传父进程 env（避免把 shell 中的 *_API_KEY 注入子进程）。
    // API key 由 pi 自身的 AuthStorage 从 ~/.pi/agent/auth.json 读取，优先级高于 env。
    // 仅补充无副作用的系统级变量（PATH/TEMP/HOME/LANG/TZ 等）+ opts.env 显式追加项 +
    // 强制 NO_COLOR/FORCE_COLOR。额外剔除任何形如 *API_KEY*/*SECRET*/*TOKEN* 的项兜底。
    // Hub 桥使用 FROMLAN_HUB_BRIDGE_KEY（避免 *TOKEN* 被剔除）。
    const baseEnv: Record<string, string> = {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SYSTEMROOT: process.env.SYSTEMROOT ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      HOME: process.env.HOME ?? "",
      USERPROFILE: process.env.USERPROFILE ?? "",
      HOMEDRIVE: process.env.HOMEDRIVE ?? "",
      HOMEPATH: process.env.HOMEPATH ?? "",
      LANG: process.env.LANG ?? "",
      LC_ALL: process.env.LC_ALL ?? "",
      TZ: process.env.TZ ?? "",
    };
    const safe = (e: Record<string, string>) => {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(e)) {
        if (!/API_KEY|SECRET|TOKEN/i.test(k)) out[k] = v;
      }
      return out;
    };
    const mergedEnv: Record<string, string> = {
      ...baseEnv,
      ...safe(this.opts.env ?? {}),
      NO_COLOR: "1",
      FORCE_COLOR: "0",
    };

    const { cmd, useShell } = resolvePi();
    if (useShell) {
      // shell:true 时参数经 cmd 拼接，必须消毒用户可控字段与注入路径
      assertShellSafe(this.opts.provider, "provider");
      assertShellSafe(this.opts.model, "model");
      assertShellSafe(this.opts.cwd, "cwd");
      assertShellSafe(this.opts.sessionId, "sessionId");
      assertShellSafe(this.opts.agentName, "agentName");
      for (const ext of this.opts.extraExtensions ?? []) {
        assertShellSafe(ext, "extraExtension");
      }
      for (let i = 0; i < args.length; i++) {
        // 跳过纯 flag（以 -- 开头且无空格的）
        if (args[i].startsWith("--") && !args[i].includes("=")) continue;
        assertShellSafe(args[i], `arg[${i}]`);
      }
    }
    this.child = spawn(cmd, args, {
      cwd: this.opts.cwd,
      env: mergedEnv,
      stdio: ["pipe", "pipe", "pipe"],
      shell: useShell,
      windowsHide: true,
    });
    this._pid = this.child.pid;
    this.closed = false;

    this.child.stdout!.on("data", (chunk: Buffer) => this.handleStdout(chunk));
    this.child.stderr!.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString("utf8"));
    });
    this.child.on("exit", (code) => {
      this.closed = true;
      this.emit("exit", code);
      for (const [id, p] of this.pending) {
        p.reject(new Error(`Pi process exited (code=${code})`));
        this.pending.delete(id);
      }
    });
    this.child.on("error", (err) => {
      this.emit("error", err);
    });
  }

  private handleStdout(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    // 缓冲上限保护：超限说明子进程异常刷屏，丢弃缓冲并强制关闭，避免 OOM。
    if (this.buffer.length > MAX_BUFFER) {
      // 立即封闭写入路径：send/sendFireAndForget 的 closed 守卫立刻拒绝后续 stdin。
      this.closed = true;
      this.buffer = Buffer.alloc(0);
      const overflowErr = new Error("Pi stdout buffer overflow, killing process");
      this.emit("error", overflowErr);
      for (const [id, p] of this.pending) {
        p.reject(overflowErr);
        this.pending.delete(id);
      }
      try {
        this.child?.kill();
      } catch {
        // ignore
      }
      return;
    }
    // 严格 JSONL：仅以 \n 分帧，剥离尾部 \r。
    let idx: number;
    while ((idx = this.buffer.indexOf(0x0a)) !== -1) {
      let line = this.buffer.subarray(0, idx).toString("utf8");
      this.buffer = this.buffer.subarray(idx + 1);
      if (line.endsWith("\r")) line = line.slice(0, -1);
      if (line.length === 0) continue;
      this.processLine(line);
    }
  }

  private processLine(line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line);
    } catch {
      this.emit("parse-error", { line });
      return;
    }
    if (parsed.type === "response" && typeof parsed.id === "string") {
      const waiter = this.pending.get(parsed.id);
      if (waiter) {
        this.pending.delete(parsed.id);
        if (parsed.success) waiter.resolve(parsed.data);
        else waiter.reject(new Error((parsed.error as string) || "Unknown error"));
      }
      return;
    }
    this.emit("event", parsed);
    if (typeof parsed.type === "string") this.emit(parsed.type, parsed);
  }

  /**
   * 发送命令并等待响应（基于 id 的 request/response）。
   * @param timeoutMs 超时毫秒；传 0 禁用超时。默认 30s。
   */
  send<T = unknown>(
    command: Record<string, unknown>,
    correlationId?: string,
    timeoutMs: number = DEFAULT_SEND_TIMEOUT_MS
  ): Promise<T> {
    if (this.closed || !this.child?.stdin) {
      return Promise.reject(new Error("Pi process has exited"));
    }
    const id = correlationId ?? randomUUID();
    const payload = JSON.stringify({ ...command, id }) + "\n";
    return new Promise<T>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clear = () => {
        if (timer !== undefined) clearTimeout(timer);
      };
      this.pending.set(id, {
        resolve: (data) => {
          clear();
          resolve(data as T);
        },
        reject: (err) => {
          clear();
          reject(err);
        },
      });
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const waiter = this.pending.get(id);
          if (!waiter) return;
          this.pending.delete(id);
          waiter.reject(new Error(`Pi RPC timeout after ${timeoutMs}ms (${String(command.type)})`));
        }, timeoutMs);
      }
      try {
        this.child!.stdin!.write(payload);
      } catch (e) {
        clear();
        this.pending.delete(id);
        reject(e as Error);
      }
    });
  }

  /** fire-and-forget：用于流式 prompt / steer / abort 等。 */
  sendFireAndForget(command: Record<string, unknown>): void {
    if (this.closed || !this.child?.stdin) {
      throw new Error("Pi process has exited");
    }
    this.child.stdin.write(JSON.stringify(command) + "\n");
  }

  /** 优雅关闭（stdin EOF → 5s kill → 8s 绝对 finalize，杜绝永久挂起）。 */
  close(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.closePromise) return this.closePromise;
    this.closePromise = new Promise<void>((resolve) => {
      let settled = false;
      const finalize = (reason: string) => {
        if (settled) return;
        settled = true;
        this.closed = true;
        // 即使从未收到 exit，也确保所有 pending 请求被 reject
        for (const [id, p] of this.pending) {
          p.reject(new Error(`Pi process closed (${reason})`));
          this.pending.delete(id);
        }
        resolve();
      };
      // 多个事件路径都能收尾：exit 是正常路径，error/close 兜底解决悬挂
      this.child!.once("exit", () => finalize("exit"));
      this.child!.once("close", () => finalize("close"));
      this.child!.once("error", (e) => {
        this.emit("error", e);
        finalize("error");
      });
      try {
        this.child!.stdin!.end();
      } catch {
        // 子进程可能已死，忽略；兜底计时器会触发 kill
      }
      setTimeout(() => {
        if (settled) return;
        if (this.child && !this.child.killed) {
          try {
            this.child.kill();
          } catch {
            // kill 抛错时仍要走 finalize，避免 Promise 永久 pending
            finalize("kill-failed");
          }
        }
      }, CLOSE_KILL_MS);
      // 绝对上限：kill 已发出但 exit/close 永不来时，仍必须 settle
      setTimeout(() => {
        if (!settled) finalize("hard-timeout");
      }, CLOSE_HARD_TIMEOUT_MS);
    });
    return this.closePromise;
  }

  get pid(): number | undefined {
    return this._pid;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}
