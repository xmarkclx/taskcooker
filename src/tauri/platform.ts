export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const platform = runtimePlatform();

  return /mac/i.test(platform) || /mac/i.test(navigator.userAgent);
}

export function isWindowsPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const platform = runtimePlatform();

  return /win/i.test(platform) || /windows/i.test(navigator.userAgent);
}

function runtimePlatform(): string {
  return (
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    ''
  );
}
