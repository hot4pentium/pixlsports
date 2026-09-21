const SUCCESS_NOTICE_PREFIXES = [
  'Game details are ready.',
  'Game details and finished stats are ready.',
  'Project and private media saved.',
  'Design saved.',
  'This design and its prepared media are now saved to the cloud.',
  'Video attached on this phone.',
  'Photo attached on this phone.',
  'Logo attached on this phone.',
  'Your Hype Card is ready on this phone.',
  'Hype Card added to Athlete Hype Page',
  'Video added to Athlete Hype Page',
  'Stats link ready',
  'Hype Card removed from Athlete Hype Page',
  'Stats link revoked.',
] as const;

const SUCCESS_NOTICE_SUFFIXES = [
  ' copied.',
  ' shared.',
  ' is ready to copy.',
] as const;

const WARNING_NOTICE_PARTS = [
  'reconnect ',
  'browser does not support',
  'browser could not capture',
  'browser could not prepare',
  'not supported in this browser',
  'this browser was not making progress',
  'this browser could not create a smaller mp4',
  'prepared video is too large',
  'upload cancelled',
] as const;

export type HypeCardNoticeTone = 'success' | 'warning' | 'error';

export function isHypeCardSuccessNotice(notice: string): boolean {
  return SUCCESS_NOTICE_PREFIXES.some((prefix) => notice.startsWith(prefix))
    || SUCCESS_NOTICE_SUFFIXES.some((suffix) => notice.endsWith(suffix));
}

export function getHypeCardNoticeTone(notice: string): HypeCardNoticeTone {
  const normalizedNotice = notice.toLowerCase();
  if (WARNING_NOTICE_PARTS.some((part) => normalizedNotice.includes(part))) return 'warning';
  if (isHypeCardSuccessNotice(notice)) return 'success';
  return 'error';
}