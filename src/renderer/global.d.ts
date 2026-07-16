import type { SessionAPI, AppAPI, PluginAPI, AgentAPI } from "../preload/index";

declare global {
  interface Window {
    sessionAPI: SessionAPI;
    appAPI: AppAPI;
    pluginAPI: PluginAPI;
    agentAPI: AgentAPI;
  }
}

export {};
