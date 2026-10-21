/**
 * Saving a generated episode to the student's own storage.
 *
 * The audio lives in object storage and is reachable from the app for
 * as long as the account exists, but a student who wants to keep an
 * episode on their phone — for the bus, for offline listening, for a
 * phone that has no data — needs it as a real file.
 *
 * iOS gets the file through the media library, which puts it in Files
 * under the app and in the Files app itself. Android gets it through
 * the Storage Access Framework, which writes it into the Downloads
 * folder the student can browse. Neither path needs a broad storage
 * permission: Android's SAF grants access to the one folder the
 * student picked, and iOS's media library write is scoped to the
 * assets the app adds.
 */

import { Platform } from "react-native";
// Legacy helpers only — the root `expo-file-system` export throws when
// these are called (see ../shared/hooks/use-document-picker.ts).
import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";

export type DownloadOutcome = {
  ok: boolean;
  /** Where it ended up, for the confirmation message. */
  location?: string;
  message: string;
};

/** Strip anything a file system would object to. */
function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "pagepay-episode";
}

function extensionFor(url: string): string {
  const withoutQuery = url.split("?")[0];
  const match = withoutQuery.match(/\.([a-z0-9]{2,4})$/i);
  if (match) return match[1].toLowerCase();
  return "mp3";
}

/**
 * Download an episode and put it where the student can find it.
 *
 * The file is fetched into the app's cache first so the same bytes can
 * be handed to the media library (iOS) or written through SAF
 * (Android) without downloading twice.
 */
export async function downloadEpisodeAudio(
  remoteUrl: string,
  title: string,
): Promise<DownloadOutcome> {
  if (!remoteUrl) {
    return { ok: false, message: "This episode has no audio yet." };
  }

  const base = safeFileName(title);
  const fileName = `${base}.${extensionFor(remoteUrl)}`;
  const localUri = `${FileSystem.cacheDirectory}${fileName}`;

  try {
    const result = await FileSystem.downloadAsync(remoteUrl, localUri);
    if (!result?.uri) {
      return { ok: false, message: "The download did not complete." };
    }

    if (Platform.OS === "ios") {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        return {
          ok: false,
          message: "Allow PagePay to add to your library to save episodes.",
        };
      }
      await MediaLibrary.saveToLibraryAsync(result.uri);
      return {
        ok: true,
        location: "your library",
        message: `Saved "${fileName}" to your library.`,
      };
    }

    // Android: write into the Downloads folder through SAF.
    const permissions =
      await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permissions.granted) {
      return {
        ok: false,
        message: "Allow access to your files to save the episode.",
      };
    }

    const targetUri = await FileSystem.StorageAccessFramework.createFileAsync(
      permissions.directoryUri,
      fileName,
      "audio/mpeg",
    );
    await FileSystem.copyAsync({ from: result.uri, to: targetUri });
    return {
      ok: true,
      location: "Downloads",
      message: `Saved "${fileName}" to your Downloads folder.`,
    };
  } catch (error) {
    if (__DEV__) {
      console.error("[audio-download] failed:", error);
    }
    return {
      ok: false,
      message: "Could not save the episode. Please try again.",
    };
  }
}
