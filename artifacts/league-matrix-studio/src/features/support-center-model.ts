export const SUPPORT_ISSUES = [
  {
    id: 'account',
    label: 'Sign-in or account access',
    steps: [
      'Refresh the page, then confirm you are signed in with the account you normally use for Pixl Sports.',
      'If you see an access or suspension notice, do not create another account to work around it; contact support.',
      'Never send a password, sign-in code, or session link in a support message.',
    ],
  },
  {
    id: 'sync',
    label: 'Schedule or sync',
    steps: [
      'Check the connection result below, then refresh the schedule once.',
      'Reopen the schedule you intended to edit and check whether your changes are still present.',
      'If a change is still waiting to save, keep the page open and do not clear browser data.',
    ],
  },
  {
    id: 'event-card',
    label: 'Event Card',
    steps: [
      'Refresh the studio and open the Event Card again.',
      'Check that the card belongs to the event you intended to share.',
      'If it is still unavailable, use the report preview below; it never includes card photos or event notes.',
    ],
  },
  {
    id: 'upload',
    label: 'Photo or file upload',
    steps: [
      'Check your connection and try the upload again after the page finishes loading.',
      'Confirm the browser can access the selected file and that it is a supported image or video type.',
      'The support report does not include the file, photo, or its filename.',
    ],
  },
  {
    id: 'other',
    label: 'Something else',
    steps: [
      'Try the connection and browser-storage checks below.',
      'Refresh only after confirming that any work waiting to save is safe.',
      'Use the report preview to share the check results without including dashboard content.',
    ],
  },
] as const;

export type SupportIssueId = (typeof SUPPORT_ISSUES)[number]['id'];
export type SupportCheckState = 'online' | 'offline' | 'available' | 'unavailable' | 'not-run';

export type SupportDiagnostics = {
  connection: 'online' | 'offline' | 'not-run';
  browserStorage: 'available' | 'unavailable' | 'not-run';
  service: 'available' | 'unavailable' | 'not-run';
};

export const EMPTY_SUPPORT_DIAGNOSTICS: SupportDiagnostics = {
  connection: 'not-run',
  browserStorage: 'not-run',
  service: 'not-run',
};

const diagnosticLabels: Record<keyof SupportDiagnostics, string> = {
  connection: 'Browser connection indicator',
  browserStorage: 'Browser storage check',
  service: 'Pixl Sports service check',
};

const diagnosticValues: Record<SupportCheckState, string> = {
  online: 'Online',
  offline: 'Offline',
  available: 'Available',
  unavailable: 'Not available',
  'not-run': 'Not run',
};

function isKnownIssue(value: string): value is SupportIssueId {
  return SUPPORT_ISSUES.some((issue) => issue.id === value);
}

function safeReference(value: string) {
  return /^PS-[0-9a-f-]{36}$/i.test(value) ? value : 'Not generated';
}

function safeTimestamp(value: string) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? 'Not available' : timestamp.toISOString();
}

export function getSupportIssue(issueId: SupportIssueId) {
  return SUPPORT_ISSUES.find((issue) => issue.id === issueId) ?? SUPPORT_ISSUES[0];
}

export function probeBrowserStorage(
  storage: Pick<Storage, 'setItem' | 'removeItem'>,
  probeId: string,
): boolean {
  const key = `pixlsports-support-check:${probeId}`;
  try {
    storage.setItem(key, 'available');
    storage.removeItem(key);
    return true;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Storage is blocked; nothing else is changed.
    }
    return false;
  }
}

export function buildSupportDiagnosticReport(input: {
  reference: string;
  issueId: string;
  createdAt: string;
  diagnostics: SupportDiagnostics;
}) {
  const issue = isKnownIssue(input.issueId)
    ? getSupportIssue(input.issueId)
    : getSupportIssue('other');
  const diagnosticLines = (Object.keys(diagnosticLabels) as (keyof SupportDiagnostics)[])
    .map((key) => `- ${diagnosticLabels[key]}: ${diagnosticValues[input.diagnostics[key]]}`);

  return [
    'Pixl Sports support report',
    `Reference: ${safeReference(input.reference)}`,
    `Issue category: ${issue.label}`,
    `Created: ${safeTimestamp(input.createdAt)}`,
    '',
    'Quick-check results:',
    ...diagnosticLines,
    '',
    'This report contains only the issue category, reference, timestamp, and check results.',
  ].join('\n');
}

export function getSupportReportShareActions(report: string, consented: boolean) {
  if (!consented || !report.trim()) return null;

  return {
    copyText: report,
  };
}

export function createSupportReference() {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : (() => {
      const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    })();
  return `PS-${uuid}`;
}
