const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function athleteFanCardUrl(token: string) {
  const origin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
    ? 'https://pixlsports.com'
    : window.location.origin;
  return `${origin}${basePath}/fan/${encodeURIComponent(token)}`;
}

export function athleteFamilyLiveTapsUrl(inviteToken: string, accessToken: string) {
  return `${athleteFanCardUrl(inviteToken)}#live-taps=${encodeURIComponent(accessToken)}`;
}
