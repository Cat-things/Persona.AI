import type { RouteObject } from "react-router";
import { CallPage } from "./pages/Call";
import { RoomEditorPage } from "./pages/RoomEditor";

/** Routes added by later phases (rooms, calls). */
export const extraRoutes: {
  public: RouteObject[];
  fullscreen: RouteObject[];
  shell: RouteObject[];
} = {
  public: [],
  fullscreen: [{ path: "call/:chatId", element: <CallPage /> }],
  shell: [
    { path: "rooms/new", element: <RoomEditorPage /> },
    { path: "rooms/:id/edit", element: <RoomEditorPage key="edit" /> },
  ],
};
