import type { CapacitorConfig } from "@capacitor/cli";

/** The Android app wraps the same Vite build that the website uses. The app ID can never change once it is on the Play Store. */
const config: CapacitorConfig = {
  appId: "com.mbwamkali.pencilarmybase",
  appName: "Pencil Army Base",
  webDir: "dist",
};

export default config;
