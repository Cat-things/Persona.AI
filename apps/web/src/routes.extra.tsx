import type { RouteObject } from "react-router";
import { CallPage } from "./pages/Call";

/** Routes added by later phases (rooms, calls). */
export const extraRoutes: {
  public: RouteObject[];
  fullscreen: RouteObject[];
  shell: RouteObject[];
} = {
  public: [],
  fullscreen: [{ path: "call/:chatId", element: <CallPage /> }],
  shell: [],
};
