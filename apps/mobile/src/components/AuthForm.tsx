import { Link } from "expo-router";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { api, errorText } from "../lib/api";
import { useAuth } from "../lib/auth";
import { Logo } from "./Logo";
import { Button, Field, T } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const { config, server, changeServer, refreshConfig } = useAuth();
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const firstRun = !!config?.needs_setup;
  const isRegister = mode === "register" || firstRun;
  const host = server?.replace(/^https?:\/\//, "") ?? "";

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (isRegister) {
        await api.register(username.trim(), password, invite ? { invite_code: invite.trim() } : {});
        if (firstRun) await refreshConfig();
      } else {
        await api.login(username.trim(), password);
      }
      // AuthProvider receives the user through onUserChange and switches stacks.
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          justifyContent: "center",
          padding: 20,
          paddingTop: insets.top + 20,
          paddingBottom: insets.bottom + 20,
          gap: 22,
        }}
      >
        <View style={{ alignItems: "center", gap: 10 }}>
          <Logo size={56} />
          <T size="2xl" weight="extrabold" style={{ textAlign: "center" }}>
            {firstRun
              ? "Create the admin account"
              : isRegister
                ? "Create an account"
                : "Welcome back"}
          </T>
          <T tone="ink2" size="sm" style={{ textAlign: "center" }}>
            {firstRun
              ? "This server is new. The first account runs it."
              : config?.instance_name || host}
          </T>
        </View>

        <View style={{ gap: 14 }}>
          <Field
            label="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete={isRegister ? "username-new" : "username"}
            textContentType="username"
            returnKeyType="next"
          />
          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            autoComplete={isRegister ? "new-password" : "current-password"}
            textContentType={isRegister ? "newPassword" : "password"}
            hint={isRegister ? "At least 8 characters." : undefined}
            returnKeyType="go"
            onSubmitEditing={submit}
          />
          {isRegister && !firstRun && config?.invite_only && (
            <Field
              label="Invite code"
              value={invite}
              onChangeText={setInvite}
              autoCapitalize="none"
              autoCorrect={false}
            />
          )}
          {error ? (
            <T size="sm" tone="err" accessibilityLiveRegion="polite">
              {error}
            </T>
          ) : null}
          <Button
            label={isRegister ? (firstRun ? "Create admin account" : "Create account") : "Sign in"}
            onPress={submit}
            loading={busy}
            disabled={!username.trim() || password.length < (isRegister ? 8 : 1)}
          />
        </View>

        {!firstRun && (
          <View style={{ alignItems: "center", gap: 14 }}>
            {isRegister ? (
              <Link href="/login" replace>
                <T tone="ember" weight="semibold">
                  I already have an account
                </T>
              </Link>
            ) : config?.registration_open !== false ? (
              <Link href="/register" replace>
                <T tone="ember" weight="semibold">
                  Create an account
                </T>
              </Link>
            ) : (
              <T size="sm" tone="ink3">
                Registration is closed on this server.
              </T>
            )}
          </View>
        )}

        <Pressable
          accessibilityRole="button"
          onPress={changeServer}
          style={{ alignSelf: "center", padding: 8 }}
        >
          <T size="sm" tone="ink3">
            Connected to {host} ·{" "}
            <T size="sm" tone="ink2" weight="semibold">
              Change server
            </T>
          </T>
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
