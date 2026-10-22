"use client";

import { useEffect, useState } from "react";
import type { Lang } from "../lib/i18n";
import { t } from "../lib/i18n";

/* PWA 安装引导：捕获 beforeinstallprompt；iOS 给手动步骤 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function InstallPrompt({ lang }: { lang: Lang }) {
  const [evt, setEvt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    const onBIP = (e: Event) => {
      e.preventDefault();
      setEvt(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBIP);
    const ua = navigator.userAgent;
    const isIos = /iP(hone|ad|od)/.test(ua) && !(window as unknown as { MSStream?: boolean }).MSStream;
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as unknown as { standalone?: boolean }).standalone === true;
    if (isIos && !standalone) setIos(true);
    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  if (dismissed) return null;
  if (!evt && !ios) return null;

  const install = async () => {
    if (!evt) return;
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === "accepted") setDismissed(true);
    setEvt(null);
  };

  return (
    <div className={`ig${ios ? " top" : ""}`} data-testid="install-prompt">
      <div className="ighd">
        <span>
          <span className="igt">{t(lang, "igTitle")}</span>
          <span className="igs">
            {ios ? t(lang, "igAppSub") : t(lang, "igSub")}
          </span>
        </span>
        <button className="igx" onClick={() => setDismissed(true)} aria-label={t(lang, "igClose")}>
          <svg viewBox="0 0 24 24" className="ic" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {!ios && (
        <div className="igft">
          <button className="iglater" onClick={() => setDismissed(true)}>
            {t(lang, "igLater")}
          </button>
          <button className="btn igbtn" onClick={install}>
            {t(lang, "igInstall")}
          </button>
        </div>
      )}
    </div>
  );
}
