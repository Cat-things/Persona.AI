import { useState } from "react";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Logo } from "../components/Logo";
import { Button, Card, Field, T } from "../components/ui";
import { useAuth } from "../lib/auth";
import { checkServer, isLocalAddress } from "../lib/server";
import { useTheme } from "../lib/theme";

/** First launch: which Persona.AI server is this app for? */
export default function Setup() {
  const { selectServer } = useAuth();
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [insecure, setInsecure] = useState<{ url: string; go: () => void } | null>(null);

  const submit = async () => {
    setBusy(true);
    setError("");
    setInsecure(null);
    const res = await checkServer(url);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const go = () => void selectServer(res.url, res.config);
    // Plain HTTP over the internet exposes passwords and chats; say so before continuing.
    if (res.url.startsWith("http://") && !isLocalAddress(res.url)) {
      setInsecure({ url: res.url, go });
      return;
    }
    go();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          gap: 24,
        }}
      >
        <View style={{ alignItems: "center", gap: 12 }}>
          <Logo size={64} />
          <T size="2xl" weight="extrabold" style={{ textAlign: "center" }}>
            Connect to your server
          </T>
          <T tone="ink2" style={{ textAlign: "center", maxWidth: 340 }}>
            Persona.AI runs on a server you or a friend host. Enter its address, the same one you
            open in a browser.
          </T>
        </View>

        <View style={{ gap: 14 }}>
          <Field
            label="Server address"
            value={url}
            onChangeText={(t) => {
              setUrl(t);
              setError("");
              setInsecure(null);
            }}
            placeholder="chat.example.com or 192.168.1.20:8000"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            onSubmitEditing={submit}
            error={error}
            autoFocus
          />
          <Button label="Connect" onPress={submit} loading={busy} disabled={!url.trim()} />
        </View>

        {insecure && (
          <Card style={{ gap: 10, borderWidth: 1, borderColor: c.warn }}>
            <T weight="bold">{"This connection isn't encrypted"}</T>
            <T size="sm" tone="ink2">
              {insecure.url} uses plain HTTP over the internet, so your password and chats could be
              read on the way. Ask the server owner to set up HTTPS (the installer does it
              automatically with a domain).
            </T>
            <Button label="Connect anyway" variant="secondary" onPress={insecure.go} />
          </Card>
        )}

        <T size="xs" tone="ink3" style={{ textAlign: "center" }}>
          Don&apos;t have a server? See github.com/Cat-things/Persona.AI to host your own.
        </T>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
