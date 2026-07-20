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
  ProjectAPI,
  UsageAPI,
  ProviderAPI,
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
    projectAPI: ProjectAPI;
    usageAPI: UsageAPI;
    providerAPI: ProviderAPI;
    useStoreDevtools: typeof import("./store").useStore;
  }
}

export {};
