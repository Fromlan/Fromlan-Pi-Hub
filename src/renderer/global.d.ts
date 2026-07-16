import type { SessionAPI, AppAPI, PluginAPI } from "../preload/index";

declare global {
  interface Window {
    sessionAPI: SessionAPI;
    appAPI: AppAPI;
    pluginAPI: PluginAPI;
  }
}

export {};
