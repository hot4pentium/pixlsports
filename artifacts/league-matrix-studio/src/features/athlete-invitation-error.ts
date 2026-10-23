/** API errors carry deliberately user-facing messages in their JSON data. */
export function athleteInvitationErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const { status, data } = error as { status?: unknown; data?: unknown };
    if (typeof status === 'number' && [400, 403, 404, 409, 429, 502, 503].includes(status)
      && data && typeof data === 'object' && 'error' in data
      && typeof data.error === 'string' && data.error.trim()) {
      return data.error;
    }
    if (status === 401) return 'Your session has expired. Sign in again before sending an invitation.';
    if (status === 429) return 'Too many invitation attempts. Wait a moment and try again.';
  }
  return 'The invitation could not be sent. Check your connection and try again.';
}
