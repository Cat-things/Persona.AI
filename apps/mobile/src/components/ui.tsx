import { initials, nameHue } from "@persona/shared";
import { Image } from "expo-image";
import { X } from "lucide-react-native";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { media } from "../lib/api";
import { font, radius, useTheme } from "../lib/theme";

// ---------- text ----------
type Tone = "ink" | "ink2" | "ink3" | "ember" | "err" | "ok";
type Size = "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
const SIZES: Record<Size, [number, number]> = {
  xs: [12, 16],
  sm: [14, 20],
  md: [16, 23],
  lg: [18, 25],
  xl: [22, 28],
  "2xl": [28, 34],
};

export function T({
  size = "md",
  tone = "ink",
  weight = "regular",
  style,
  ...rest
}: TextProps & { size?: Size; tone?: Tone; weight?: keyof typeof font }) {
  const { c } = useTheme();
  const [fs, lh] = SIZES[size];
  return (
    <Text
      {...rest}
      style={[{ color: c[tone], fontFamily: font[weight], fontSize: fs, lineHeight: lh }, style]}
    />
  );
}

// ---------- buttons ----------
type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  label,
  icon,
  variant = "primary",
  loading,
  disabled,
  style,
  small,
  ...rest
}: Omit<PressableProps, "style" | "children"> & {
  label: string;
  icon?: ReactNode;
  variant?: Variant;
  loading?: boolean;
  small?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  const bg =
    variant === "primary"
      ? c.ember
      : variant === "secondary"
        ? c.surface2
        : variant === "danger"
          ? c.err
          : "transparent";
  const fg = variant === "primary" ? c.emberInk : variant === "danger" ? "#fff" : c.ink;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!(disabled || loading), busy: !!loading }}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: bg, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
      {...rest}
    >
      {loading ? <ActivityIndicator color={fg} size="small" /> : icon}
      <Text style={{ color: fg, fontFamily: font.semibold, fontSize: small ? 14 : 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}

export function IconButton({
  label,
  children,
  style,
  size = 44,
  active,
  ...rest
}: Omit<PressableProps, "style"> & {
  label: string;
  children: ReactNode;
  size?: number;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: active ? c.emberSoft : pressed ? c.surface2 : "transparent",
        },
        style,
      ]}
      {...rest}
    >
      {children}
    </Pressable>
  );
}

export function Chip({
  label,
  active,
  onPress,
  icon,
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  icon?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: active ? c.ink : pressed ? c.surface2 : c.surface,
          borderColor: active ? c.ink : c.line,
        },
      ]}
    >
      {icon}
      <Text
        style={{ color: active ? c.bg : c.ink2, fontFamily: font.medium, fontSize: 14 }}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

// ---------- form ----------
export function Field({
  label,
  hint,
  error,
  style,
  multiline,
  ...rest
}: TextInputProps & { label?: string; hint?: string; error?: string }) {
  const { c } = useTheme();
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      {label && (
        <T size="sm" weight="semibold" tone="ink2">
          {label}
        </T>
      )}
      <TextInput
        placeholderTextColor={c.ink3}
        selectionColor={c.ember}
        accessibilityLabel={label}
        multiline={multiline}
        onFocus={(e) => {
          setFocus(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocus(false);
          rest.onBlur?.(e);
        }}
        style={[
          styles.field,
          {
            color: c.ink,
            backgroundColor: c.surface,
            borderColor: error ? c.err : focus ? c.ember : c.line,
            minHeight: multiline ? 96 : 48,
            textAlignVertical: multiline ? "top" : "center",
          },
          style as StyleProp<TextStyle>,
        ]}
        {...rest}
      />
      {error ? (
        <T size="xs" tone="err">
          {error}
        </T>
      ) : hint ? (
        <T size="xs" tone="ink3">
          {hint}
        </T>
      ) : null}
    </View>
  );
}

// ---------- avatar ----------
export function Avatar({
  src,
  name,
  size = 40,
  ring,
}: {
  src?: string | null;
  name: string;
  size?: number;
  ring?: boolean;
}) {
  const { c } = useTheme();
  const uri = media(src);
  const border = ring ? { borderWidth: 2, borderColor: c.bg } : null;
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[{ width: size, height: size, borderRadius: size / 2 }, border]}
        contentFit="cover"
        transition={150}
        accessibilityIgnoresInvertColors
        accessible={false}
      />
    );
  }
  const hue = nameHue(name);
  return (
    <View
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: `hsl(${hue}, 35%, 32%)`,
          alignItems: "center",
          justifyContent: "center",
        },
        border,
      ]}
    >
      <Text style={{ color: "#fff", fontFamily: font.bold, fontSize: size * 0.38 }}>
        {initials(name)}
      </Text>
    </View>
  );
}

// ---------- layout helpers ----------
export function Center({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.center, style]}>{children}</View>;
}

export function Loading() {
  const { c } = useTheme();
  return (
    <Center>
      <ActivityIndicator color={c.ember} />
    </Center>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <Center style={{ padding: 32, gap: 8 }}>
      <T size="lg" weight="bold" style={{ textAlign: "center" }}>
        {title}
      </T>
      {body && (
        <T tone="ink2" style={{ textAlign: "center" }}>
          {body}
        </T>
      )}
      {action && <View style={{ marginTop: 12 }}>{action}</View>}
    </Center>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  return (
    <View style={[{ backgroundColor: c.surface, borderRadius: radius.card, padding: 16 }, style]}>
      {children}
    </View>
  );
}

// ---------- bottom sheet ----------
export function Sheet({
  open,
  onClose,
  title,
  children,
  scroll = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  scroll?: boolean;
}) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable
        style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}
        onPress={onClose}
        accessibilityLabel="Close"
      />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.panel, paddingBottom: Math.max(insets.bottom, 16) },
        ]}
      >
        <View style={[styles.grabber, { backgroundColor: c.line }]} />
        {title && (
          <View style={styles.sheetHead}>
            <T size="lg" weight="bold" style={{ flex: 1 }}>
              {title}
            </T>
            <IconButton label="Close" onPress={onClose} size={36}>
              <X size={20} color={c.ink2} />
            </IconButton>
          </View>
        )}
        {scroll ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 4 }}>
            {children}
          </ScrollView>
        ) : (
          children
        )}
      </View>
    </Modal>
  );
}

export function SheetItem({
  label,
  icon,
  onPress,
  danger,
  right,
}: {
  label: string;
  icon?: ReactNode;
  onPress: () => void;
  danger?: boolean;
  right?: ReactNode;
}) {
  const { c } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.sheetItem, pressed && { backgroundColor: c.surface2 }]}
    >
      {icon}
      <T style={{ flex: 1 }} tone={danger ? "err" : "ink"} weight="medium">
        {label}
      </T>
      {right}
    </Pressable>
  );
}

// ---------- toast ----------
type ToastKind = "info" | "success" | "error";
const ToastCtx = createContext<(msg: string, kind?: ToastKind) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [msg, setMsg] = useState<{ text: string; kind: ToastKind } | null>(null);
  const [anim] = useState(() => new Animated.Value(0));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback(
    (text: string, kind: ToastKind = "info") => {
      setMsg({ text, kind });
      if (timer.current) clearTimeout(timer.current);
      Animated.timing(anim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      timer.current = setTimeout(
        () =>
          Animated.timing(anim, { toValue: 0, duration: 180, useNativeDriver: true }).start(() =>
            setMsg(null),
          ),
        kind === "error" ? 4500 : 2600,
      );
    },
    [anim],
  );
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {msg && (
        <Animated.View
          pointerEvents="none"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            {
              top: insets.top + 8,
              backgroundColor: msg.kind === "error" ? c.err : c.ink,
              opacity: anim,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) },
              ],
            },
          ]}
        >
          <Text style={{ color: msg.kind === "error" ? "#fff" : c.bg, fontFamily: font.medium }}>
            {msg.text}
          </Text>
        </Animated.View>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

const styles = StyleSheet.create({
  btn: {
    minHeight: 48,
    borderRadius: radius.control,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  btnSmall: { minHeight: 38, paddingHorizontal: 14 },
  chip: {
    height: 36,
    paddingHorizontal: 14,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  field: {
    borderWidth: 1,
    borderRadius: radius.control,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontFamily: font.regular,
    fontSize: 16,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: "88%",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 8 },
  sheetHead: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  sheetItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    paddingHorizontal: 8,
    borderRadius: radius.control,
  },
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: radius.control,
    alignItems: "center",
  },
});
