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
  'Stats link ready',
  'Hype Card removed from Athlete Hype Page',
  'Stats link revoked.',
] as const;

const SUCCESS_NOTICE_SUFFIXES = [
  ' copied.',
  ' shared.',
  ' is ready to copy.',
] as const;

export function isHypeCardSuccessNotice(notice: string): boolean {
  return SUCCESS_NOTICE_PREFIXES.some((prefix) => notice.startsWith(prefix))
    || SUCCESS_NOTICE_SUFFIXES.some((suffix) => notice.endsWith(suffix));
}