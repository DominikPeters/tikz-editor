export type ModifierKeyLabels = {
  shift: string;
  alt: string;
  primary: string;
};

type NavigatorWithUserAgentData = Navigator & {
  userAgentData?: {
    platform?: string;
  };
};

export function readCurrentPlatformName(): string {
  if (typeof navigator === "undefined") {
    return "";
  }

  const nav = navigator as NavigatorWithUserAgentData;
  const userAgentPlatform = nav.userAgentData?.platform;
  if (userAgentPlatform?.trim()) {
    return userAgentPlatform;
  }
  return navigator.platform ?? "";
}

export function isMacLikePlatform(platformName: string = readCurrentPlatformName()): boolean {
  return /(mac|iphone|ipad)/i.test(platformName);
}

export function isWindowsLikePlatform(platformName: string = readCurrentPlatformName()): boolean {
  return /win/i.test(platformName);
}

export function formatAccelerator(
  accelerator: string | undefined,
  platformName: string = readCurrentPlatformName()
): string {
  if (!accelerator) {
    return "";
  }
  const isMac = isMacLikePlatform(platformName);
  return accelerator
    .split("+")
    .map((part) => part === "CmdOrCtrl" ? (isMac ? "Cmd" : "Ctrl") : part)
    .join(isMac ? " " : "+");
}

export function getModifierKeyLabels(platformName: string = readCurrentPlatformName()): ModifierKeyLabels {
  if (isMacLikePlatform(platformName)) {
    return {
      shift: "⇧",
      alt: "⌥",
      primary: "⌘"
    };
  }

  return {
    shift: "⇧",
    alt: "Alt",
    primary: "Ctrl"
  };
}
