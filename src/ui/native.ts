import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Clipboard } from "@capacitor/clipboard";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

/** True inside the Android app, where the phone's own share sheet, clipboard and back button replace the browser's. */
export const isApp = Capacitor.isNativePlatform();

/** Android back button: `goBack` steps back inside the game and returns false when there is nowhere left to go, which closes the app. */
export function onBackButton(goBack: () => boolean): void {
  if (!isApp) return;
  void App.addListener("backButton", () => {
    if (!goBack()) void App.exitApp();
  });
}

/** Puts text on the clipboard; resolves true once it is there. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (isApp) await Clipboard.write({ string: text });
    else if (navigator.clipboard) await navigator.clipboard.writeText(text);
    else return false;
    return true;
  } catch {
    return false;
  }
}

/** Opens the phone's share sheet for an image (Save to Photos, Messages and so on). The app has no browser download, so this is its only way out. */
export async function shareImage(blob: Blob, fileName: string, title: string): Promise<void> {
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  const { uri } = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
  try {
    await Share.share({ title, files: [uri] });
  } catch {
    // Closing the share sheet is a choice, not a failure.
  }
}
