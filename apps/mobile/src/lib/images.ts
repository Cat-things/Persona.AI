import * as ImagePicker from "expo-image-picker";
import { api } from "./api";

/**
 * Pick a photo (square crop on Android/iOS), upload it, return its "/media/..." URL.
 * The server re-encodes every upload, which strips EXIF data such as GPS position.
 */
export async function pickImage(): Promise<string | null> {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.9,
  });
  if (res.canceled || !res.assets?.[0]) return null;
  const a = res.assets[0];
  const { url } = await api.uploadImage({
    uri: a.uri,
    name: a.fileName ?? "image.jpg",
    type: a.mimeType ?? "image/jpeg",
  });
  return url;
}
