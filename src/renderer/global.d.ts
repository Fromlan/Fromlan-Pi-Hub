/// <reference types="vite/client" />
import type {
  SessionAPI,
  AppAPI,
  PluginAPI,
  AgentAPI,
  IssueAPI,
} from "../preload/index";

declare global {
  interface Window {
    sessionAPI: SessionAPI;
    appAPI: AppAPI;
    pluginAPI: PluginAPI;
    agentAPI: AgentAPI;
    issueAPI: IssueAPI;
    useStoreDevtools: typeof import("./store").useStore;
  }
}

export {};
