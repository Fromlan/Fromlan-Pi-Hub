/// <reference types="vite/client" />
import type {
  SessionAPI,
  AppAPI,
  PluginAPI,
  AgentAPI,
  IssueAPI,
  SquadAPI,
  AutopilotAPI,
  InboxAPI,
} from "../preload/index";

declare global {
  interface Window {
    sessionAPI: SessionAPI;
    appAPI: AppAPI;
    pluginAPI: PluginAPI;
    agentAPI: AgentAPI;
    issueAPI: IssueAPI;
    squadAPI: SquadAPI;
    autopilotAPI: AutopilotAPI;
    inboxAPI: InboxAPI;
    useStoreDevtools: typeof import("./store").useStore;
  }
}

export {};
