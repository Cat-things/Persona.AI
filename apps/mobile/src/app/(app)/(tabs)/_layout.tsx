import { Tabs } from "expo-router";
import { Compass, MessageCircle, Plus, UserRound } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { font, useTheme } from "../../../lib/theme";

export default function TabsLayout() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.ink,
        tabBarInactiveTintColor: c.ink3,
        tabBarStyle: {
          backgroundColor: c.bg,
          borderTopColor: c.line,
          height: 58 + insets.bottom,
          paddingTop: 6,
        },
        tabBarLabelStyle: { fontFamily: font.medium, fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Discover",
          tabBarIcon: ({ color }) => <Compass color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: "Chats",
          tabBarIcon: ({ color }) => <MessageCircle color={color} size={24} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: "Create",
          tabBarIcon: ({ focused }) => <Plus color={focused ? c.ember : c.ink3} size={26} />,
        }}
      />
      <Tabs.Screen
        name="me"
        options={{ title: "You", tabBarIcon: ({ color }) => <UserRound color={color} size={24} /> }}
      />
    </Tabs>
  );
}
