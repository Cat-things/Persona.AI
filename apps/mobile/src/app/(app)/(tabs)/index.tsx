import type { CharacterCard as Card } from "@persona/shared";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Search, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CharacterCard } from "../../../components/CharacterCard";
import { Avatar, Chip, EmptyState, T } from "../../../components/ui";
import { api, errorText } from "../../../lib/api";
import { useUser } from "../../../lib/auth";
import { font, radius, useTheme } from "../../../lib/theme";

type Sort = "popular" | "trending" | "recent" | "featured";
const SORTS: { id: Sort; label: string }[] = [
  { id: "popular", label: "Popular" },
  { id: "trending", label: "Trending" },
  { id: "recent", label: "New" },
  { id: "featured", label: "Featured" },
];

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Discover() {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const user = useUser();
  const [sort, setSort] = useState<Sort>("popular");
  const [tag, setTag] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const query = useDebounced(q.trim());

  const tags = useQuery({ queryKey: ["tags"], queryFn: () => api.tags(), staleTime: 300_000 });
  const recent = useQuery({ queryKey: ["chats"], queryFn: () => api.chats() });
  const list = useInfiniteQuery({
    queryKey: ["discover", sort, tag, query],
    queryFn: ({ pageParam }) =>
      api.discover({
        sort,
        tag: tag ?? undefined,
        q: query || undefined,
        cursor: pageParam ?? undefined,
        limit: 24,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (p) => p.next_cursor,
  });
  const items: Card[] = list.data?.pages.flatMap((p) => p.items) ?? [];
  const searching = !!query || !!tag;
  const continueChats = (recent.data ?? []).filter((ch) => ch.character).slice(0, 8);

  const header = (
    <View style={{ gap: 16, paddingBottom: 12 }}>
      <T size="2xl" weight="extrabold">
        Hi, {user.display_name || user.username}
      </T>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: c.surface,
          borderRadius: radius.pill,
          paddingHorizontal: 14,
          height: 46,
        }}
      >
        <Search size={18} color={c.ink3} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search characters"
          placeholderTextColor={c.ink3}
          accessibilityLabel="Search characters"
          returnKeyType="search"
          autoCorrect={false}
          style={{ flex: 1, color: c.ink, fontFamily: font.regular, fontSize: 16 }}
        />
        {q ? (
          <Pressable accessibilityLabel="Clear search" onPress={() => setQ("")} hitSlop={10}>
            <X size={18} color={c.ink3} />
          </Pressable>
        ) : null}
      </View>

      {!searching && continueChats.length > 0 && (
        <View style={{ gap: 10 }}>
          <T weight="bold" size="lg">
            Continue chatting
          </T>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 14 }}
          >
            {continueChats.map((ch) => (
              <Pressable
                key={ch.id}
                accessibilityRole="button"
                accessibilityLabel={`Continue chat with ${ch.character!.name}`}
                onPress={() => router.push(`/chat/${ch.id}`)}
                style={{ width: 72, alignItems: "center", gap: 6 }}
              >
                <Avatar src={ch.character!.avatar_url} name={ch.character!.name} size={64} />
                <T size="xs" tone="ink2" numberOfLines={1}>
                  {ch.character!.name}
                </T>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8 }}
      >
        {SORTS.map((s) => (
          <Chip
            key={s.id}
            label={s.label}
            active={sort === s.id && !tag}
            onPress={() => {
              setTag(null);
              setSort(s.id);
            }}
          />
        ))}
        {(tags.data ?? []).slice(0, 14).map((t) => (
          <Chip
            key={t.tag}
            label={`#${t.tag}`}
            active={tag === t.tag}
            onPress={() => setTag(tag === t.tag ? null : t.tag)}
          />
        ))}
      </ScrollView>
    </View>
  );

  return (
    <FlatList
      data={items}
      keyExtractor={(i) => i.id}
      renderItem={({ item }) => <CharacterCard c={item} />}
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      ListHeaderComponent={header}
      contentContainerStyle={{ padding: 16, paddingTop: insets.top + 12, paddingBottom: 24 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      onEndReachedThreshold={0.6}
      onEndReached={() => list.hasNextPage && !list.isFetchingNextPage && void list.fetchNextPage()}
      refreshControl={
        <RefreshControl
          tintColor={c.ember}
          colors={[c.ember]}
          refreshing={list.isRefetching && !list.isFetchingNextPage}
          onRefresh={() => {
            void list.refetch();
            void recent.refetch();
          }}
        />
      }
      ListEmptyComponent={
        list.isLoading ? (
          <View style={{ gap: 10 }}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={{ height: 88, borderRadius: radius.card, backgroundColor: c.surface }}
              />
            ))}
          </View>
        ) : list.isError ? (
          <EmptyState title="Couldn't load characters" body={errorText(list.error)} />
        ) : (
          <EmptyState
            title={searching ? "No characters match" : "No characters yet"}
            body={
              searching ? "Try another word or tag." : "Create the first one from the Create tab."
            }
          />
        )
      }
    />
  );
}
