export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const platform =
    (navigator as { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';

  return /mac/i.test(platform) || /mac/i.test(navigator.userAgent);
}
