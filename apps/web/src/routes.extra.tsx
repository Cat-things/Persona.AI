import type { RouteObject } from "react-router";

/** Routes added by later phases (rooms, calls). */
export const extraRoutes: {
  public: RouteObject[];
  fullscreen: RouteObject[];
  shell: RouteObject[];
} = {
  public: [],
  fullscreen: [],
  shell: [],
};
