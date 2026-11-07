import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { router } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId;
}

/** True when this build can receive remote pushes (built with an EAS project id). */
export const remotePushAvailable = () => !!projectId() && Device.isDevice;

async function ensurePermission(): Promise<boolean> {
  if (Platform.OS === "android") {
    // Android 13+ won't show the permission prompt until a channel exists.
    await Notifications.setNotificationChannelAsync("default", {
      name: "Updates",
      // eslint-disable-next-line import/namespace -- enum re-exported via `export *`; tsc resolves it
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  let { granted } = await Notifications.getPermissionsAsync();
  if (!granted) ({ granted } = await Notifications.requestPermissionsAsync());
  return granted;
}

function open(data: unknown) {
  const d = (data ?? {}) as { url?: unknown; kind?: unknown };
  if (typeof d.url === "string" && d.url.startsWith("/")) router.push(d.url as never);
}

/**
 * Remote push through Expo when the build has a project id; otherwise (self-built APKs)
 * poll the server's notification list while the app is open and show them locally.
 */
export function usePushNotifications(signedIn: boolean) {
  const lastSeen = useRef<string | null>(null);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    void (async () => {
      if (!(await ensurePermission()) || cancelled) return;
      const id = projectId();
      if (id && Device.isDevice) {
        try {
          const { data } = await Notifications.getExpoPushTokenAsync({ projectId: id });
          await api.registerPushToken(data, Platform.OS);
        } catch {
          /* push not configured for this build; polling below still works */
        }
      }
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((r) =>
      open(r.notification.request.content.data),
    );
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [signedIn]);

  useEffect(() => {
    if (!signedIn || remotePushAvailable()) return;
    let stopped = false;
    const poll = async () => {
      if (stopped || AppState.currentState !== "active") return;
      try {
        const list = await api.notifications(); // newest first
        const since = lastSeen.current;
        // First poll only sets the watermark, so old notifications don't all pop up at once.
        if (since !== null) {
          for (const n of list.filter((x) => !x.read_at && x.created_at > since).reverse()) {
            await Notifications.scheduleNotificationAsync({
              content: { title: n.title, body: n.body, data: n.data },
              trigger: null,
            });
          }
        }
        lastSeen.current = list[0]?.created_at ?? since ?? "";
      } catch {
        /* offline */
      }
    };
    void poll();
    const t = setInterval(poll, 30_000);
    const app = AppState.addEventListener("change", (s) => s === "active" && void poll());
    return () => {
      stopped = true;
      clearInterval(t);
      app.remove();
    };
  }, [signedIn]);
}
