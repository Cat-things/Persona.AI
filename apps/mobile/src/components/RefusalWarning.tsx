import type { RefusalNotice } from "@persona/shared";
import * as Haptics from "expo-haptics";
import { Hand, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Modal, Pressable, View } from "react-native";
import { radius, useTheme } from "../lib/theme";
import { Button, T } from "./ui";

interface Props {
  refusal: { notice: RefusalNotice; name: string } | null;
  onClose: () => void;
}

/**
 * Escalating response when the model keeps refusing: a small banner for the first couple
 * of refusals, then a full-screen popup whose button stays locked for longer each time.
 */
export function RefusalWarning({ refusal, onClose }: Props) {
  const { c } = useTheme();
  if (!refusal) return null;
  const name = refusal.name || "The character";
  if (refusal.notice.level === "stop")
    return (
      <StopModal key={refusal.notice.count} notice={refusal.notice} name={name} onClose={onClose} />
    );
  return (
    <View
      accessibilityRole="alert"
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 10,
        marginHorizontal: 12,
        marginTop: 8,
        padding: 10,
        borderRadius: radius.control,
        borderWidth: 1,
        borderColor: c.warn,
        backgroundColor: c.surface,
      }}
    >
      <Hand size={18} color={c.warn} style={{ marginTop: 2 }} />
      <T size="sm" style={{ flex: 1 }}>
        {refusal.notice.count > 1
          ? `${name} has said no ${refusal.notice.count} times now. Please ease off and take the story somewhere else.`
          : `${name} won't go there. Take a breath and steer the story in a different direction.`}
      </T>
      <Pressable accessibilityLabel="Dismiss" onPress={onClose} hitSlop={10}>
        <X size={16} color={c.ink2} />
      </Pressable>
    </View>
  );
}

function StopModal({
  notice,
  name,
  onClose,
}: {
  notice: RefusalNotice;
  name: string;
  onClose: () => void;
}) {
  const { c } = useTheme();
  const [left, setLeft] = useState(notice.hold_seconds);

  useEffect(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, []);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);

  return (
    // Back button does nothing until the countdown ends.
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (left <= 0) onClose();
      }}
    >
      <View
        style={{ flex: 1, backgroundColor: "#000000cc", justifyContent: "center", padding: 20 }}
      >
        <View
          accessibilityViewIsModal
          style={{
            backgroundColor: c.surface,
            borderRadius: 20,
            borderWidth: 1,
            borderColor: c.err,
            padding: 24,
            alignItems: "center",
            gap: 14,
          }}
        >
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 34,
              backgroundColor: c.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Hand size={34} color={c.err} />
          </View>
          <T
            size="2xl"
            weight="extrabold"
            style={{ textAlign: "center" }}
            accessibilityRole="header"
          >
            Please stop here
          </T>
          <T tone="ink2" style={{ textAlign: "center" }}>
            {name} has refused {notice.count} times in the last half hour. Pushing again won&apos;t
            change the answer, and the characters on this server won&apos;t go there.
          </T>
          <T tone="ink2" style={{ textAlign: "center" }}>
            Take a break, or start the story somewhere new.
          </T>
          <Button
            label={left > 0 ? `I understand (${left})` : "I understand"}
            disabled={left > 0}
            onPress={onClose}
            style={{ alignSelf: "stretch", marginTop: 4 }}
          />
        </View>
      </View>
    </Modal>
  );
}
