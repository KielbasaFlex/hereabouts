import type { CapacitorConfig } from "@capacitor/cli";

// `webDir: "www"` currently points at a placeholder shell (`www/index.html`)
// committed only so `cap add android` had something to copy — see
// `apps/native/README.md`. A real build points this at `apps/web`'s Vite
// output (e.g. `../web/dist`, copied in before `cap sync`), per PLAN.md
// §2.2's "Capacitor wraps a static bundle" design.
const config: CapacitorConfig = {
  appId: "com.hereabouts.app",
  appName: "Hereabouts",
  webDir: "www",
};

export default config;
