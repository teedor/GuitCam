import { useCallback, useEffect, useState } from "react";

/**
 * Minimal install prompt helper for Chromium-based browsers.
 *
 * Notes:
 * - Many browsers no longer show an automatic install prompt.
 * - The prompt can only be triggered from a user gesture (e.g. a button click).
 * - This event is Chromium-specific; iOS Safari uses "Add to Home Screen" instead.
 */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isInstalled, setIsInstalled] = useState(false);

  useEffect(() => {
    // Detect display-mode to hide install button if already installed/launched as PWA.
    const mq = window.matchMedia?.("(display-mode: standalone)");
    const updateInstalled = () => {
      const standalone =
        Boolean(mq?.matches) ||
        // iOS legacy
        Boolean(window.navigator?.standalone);
      setIsInstalled(standalone);
    };
    updateInstalled();
    mq?.addEventListener?.("change", updateInstalled);
    return () => mq?.removeEventListener?.("change", updateInstalled);
  }, []);

  useEffect(() => {
    const onBeforeInstallPrompt = (e) => {
      // Prevent the mini-infobar from appearing on mobile.
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const onAppInstalled = () => {
      setDeferredPrompt(null);
      setIsInstalled(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const promptToInstall = useCallback(async () => {
    if (!deferredPrompt) return { outcome: "unavailable" };
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setDeferredPrompt(null);
      return choice;
    } catch {
      return { outcome: "dismissed" };
    }
  }, [deferredPrompt]);

  return {
    canInstall: Boolean(deferredPrompt) && !isInstalled,
    isInstalled,
    promptToInstall
  };
}

