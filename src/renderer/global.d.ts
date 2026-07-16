import type { SessionAPI, AppAPI } from "../preload/index";

declare global {
  interface Window {
    sessionAPI: SessionAPI;
    appAPI: AppAPI;
  }
}

export {};
