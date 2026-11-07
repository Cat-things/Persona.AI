import { compactNumber, type CharacterCard as Card } from "@persona/shared";
import { router } from "expo-router";
import { MessageCircle } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { radius, useTheme } from "../lib/theme";
import { Avatar, T } from "./ui";

/** Row card used in grids and lists: avatar, name, tagline, creator, chat count. */
export function CharacterCard({ c: ch, wide }: { c: Card; wide?: boolean }) {
  const { c } = useTheme();
  const by = ch.creator?.username ?? ch.creator_credit;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${ch.name}. ${ch.tagline}`}
      onPress={() => router.push(`/character/${ch.id}`)}
      style={({ pressed }) => ({
        flexDirection: "row",
        gap: 12,
        padding: 12,
        borderRadius: radius.card,
        backgroundColor: pressed ? c.surface2 : c.surface,
        width: wide ? 290 : undefined,
      })}
    >
      <Avatar src={ch.avatar_url} name={ch.name} size={64} />
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <T weight="bold" numberOfLines={1}>
          {ch.name}
        </T>
        {by ? (
          <T size="xs" tone="ink3" numberOfLines={1}>
            By @{by}
          </T>
        ) : null}
        <T size="sm" tone="ink2" numberOfLines={2}>
          {ch.tagline}
        </T>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 }}>
          <MessageCircle size={12} color={c.ink3} />
          <T size="xs" tone="ink3">
            {compactNumber(ch.interaction_count)}
          </T>
        </View>
      </View>
    </Pressable>
  );
}
