import { Stack } from "expo-router";
import { useTheme } from "../../lib/theme";

export default function AppLayout() {
  const { c } = useTheme();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: c.bg },
        animation: "slide_from_right",
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="call/[id]"
        options={{ animation: "fade_from_bottom", gestureEnabled: false }}
      />
    </Stack>
  );
}
