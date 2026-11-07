import { historyBucket, type ChatListItem } from "@persona/shared";
import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Users } from "lucide-react-native";
import { Pressable, RefreshControl, SectionList, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar, Button, EmptyState, IconButton, Loading, T } from "../../../components/ui";
import { api, errorText } from "../../../lib/api";
import { useTheme } from "../../../lib/theme";

function RoomAvatars({ srcs, name }: { srcs: (string | null)[]; name: string }) {
  return (
    <View style={{ width: 52, height: 52 }}>
      {srcs.slice(0, 2).map((s, i) => (
        <View key={i} style={{ position: "absolute", left: i * 14, top: i * 14 }}>
          <Avatar src={s} name={name} size={38} ring />
        </View>
      ))}
    </View>
  );
}

function Row({ chat }: { chat: ChatListItem }) {
  const { c } = useTheme();
  const name = chat.character?.name ?? chat.room_name ?? chat.title;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Chat with ${name}`}
      onPress={() => router.push(`/chat/${chat.id}`)}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingVertical: 10,
        paddingHorizontal: 16,
        backgroundColor: pressed ? c.surface : "transparent",
      })}
    >
      {chat.room_id ? (
        <RoomAvatars srcs={chat.room_avatars} name={name} />
      ) : (
        <Avatar src={chat.character?.avatar_url} name={name} size={52} />
      )}
      <View style={{ flex: 1, minWidth: 0 }}>
        <T weight="semibold" numberOfLines={1}>
          {name}
        </T>
        <T size="sm" tone="ink3" numberOfLines={1}>
          {chat.last_message || "No messages yet"}
        </T>
      </View>
    </Pressable>
  );
}

export default function Chats() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const q = useQuery({ queryKey: ["chats"], queryFn: () => api.chats() });

  const sections: { title: string; data: ChatListItem[] }[] = [];
  for (const chat of q.data ?? []) {
    const b = historyBucket(chat.updated_at);
    const last = sections.at(-1);
    if (last?.title === b) last.data.push(chat);
    else sections.push({ title: b, data: [chat] });
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <T size="2xl" weight="extrabold" style={{ flex: 1 }}>
          Chats
        </T>
        <IconButton label="New group chat" onPress={() => router.push("/room/new")}>
          <Users size={22} color={c.ink} />
        </IconButton>
      </View>
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <EmptyState title="Couldn't load your chats" body={errorText(q.error)} />
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => <Row chat={item} />}
          renderSectionHeader={({ section }) => (
            <T
              size="xs"
              tone="ink3"
              weight="semibold"
              style={{
                paddingHorizontal: 16,
                paddingTop: 14,
                paddingBottom: 4,
                backgroundColor: c.bg,
              }}
            >
              {section.title}
            </T>
          )}
          refreshControl={
            <RefreshControl
              tintColor={c.ember}
              colors={[c.ember]}
              refreshing={q.isRefetching}
              onRefresh={() => void q.refetch()}
            />
          }
          ListEmptyComponent={
            <EmptyState
              title="No chats yet"
              body="Pick a character on Discover to start talking."
              action={<Button label="Discover characters" onPress={() => router.push("/")} />}
            />
          }
          contentContainerStyle={{ paddingBottom: 24, flexGrow: 1 }}
        />
      )}
    </View>
  );
}
