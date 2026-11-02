import React, { useState } from 'react';
import { useUser } from '@clerk/react';
import { RefreshCw } from 'lucide-react';
import {
  getListAdminNativeDeletionEmailsQueryKey,
  useListAdminNativeDeletionEmails,
  type AdminNativeDeletionEmail,
} from '@workspace/api-client-react';

const PAGE_SIZE = 20;
const STAGES: Record<AdminNativeDeletionEmail['stage'], { label: string; detail: string; warning?: boolean }> = {
  awaiting_cleanup: {
    label: 'Awaiting cleanup',
    detail: 'The completion email waits until account cleanup finishes.',
  },
  waiting_to_send: {
    label: 'Waiting to send',
    detail: 'Cleanup finished. The email is queued or awaiting retry after a definite rejection.',
  },
  provider_accepted: {
    label: 'Accepted by email provider',
    detail: 'The provider accepted the email. Inbox delivery and whether it was read are not known.',
  },
  delivery_uncertain: {
    label: 'Delivery uncertain',
    detail: 'A send was started but acceptance is unconfirmed; it may still be in progress. The worker may retry with the same key within 23 hours of the first attempt.',
    warning: true,
  },
  review_required: {
    label: 'Uncertain — review required',
    detail: 'Acceptance is unconfirmed and the 23-hour safe retry window ended. Automatic sending is paused to avoid duplicates. Review provider records; do not blindly resend.',
    warning: true,
  },
  contact_retention_expired: {
    label: 'Contact retention expired',
    detail: 'The seven-day contact window ended without recorded acceptance. Sending is no longer eligible; the retention sweep removes any remaining address. This record cannot prove delivery.',
    warning: true,
  },
  no_verified_contact: {
    label: 'No verified contact available',
    detail: 'No retained verified recipient is available. Older requests may have removed the sign-in identity before capturing a recipient.',
  },
};

function timestamp(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Not recorded';
}

export function AdminNativeDeletionEmailRows({ items }: { items: AdminNativeDeletionEmail[] }) {
  return (
    <div className="admin-table-wrap mt-5">
      <table className="admin-table">
        <caption className="sr-only">Native deletion completion-email status; timestamps are in your local time zone</caption>
        <thead><tr>
          <th scope="col">Deletion reference / scope</th>
          <th scope="col">Email stage</th>
          <th scope="col">Timing (local)</th>
        </tr></thead>
        <tbody>{items.map((item) => {
          const stage = STAGES[item.stage];
          return <tr key={item.reference} data-testid={`row-deletion-email-${item.reference}`}>
            <td>
              <code className="block break-all text-xs" data-testid={`text-deletion-reference-${item.reference}`}>{item.reference}</code>
              <p className="mt-2 text-xs text-[#60778a]">{item.scope === 'independent' ? 'Independent iPhone account' : 'iPhone access only — web data preserved'}</p>
            </td>
            <td className="min-w-[230px]">
              <span className={`admin-chip ${stage.warning ? 'admin-chip-warn' : ''}`} data-testid={`status-deletion-email-${item.reference}`}>{stage.label}</span>
              <p className="mt-2 max-w-md text-xs leading-relaxed text-[#60778a]">{stage.detail}</p>
            </td>
            <td className="min-w-[220px]">
              <dl className="space-y-1 text-xs">
                {([
                  ['Requested', item.requestedAt],
                  ['Cleanup completed', item.completedAt],
                  ['First send attempt', item.firstAttemptAt],
                  ['Last worker attempt', item.lastAttemptAt],
                  ['Provider accepted', item.providerAcceptedAt],
                ] as const).map(([label, value]) => <div key={label}><dt className="inline font-bold">{label}: </dt><dd className="inline">{timestamp(value)}</dd></div>)}
              </dl>
            </td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

export function AdminNativeDeletionEmails() {
  const { user } = useUser();
  const [offset, setOffset] = useState(0);
  const params = { limit: PAGE_SIZE, offset };
  const query = useListAdminNativeDeletionEmails(params, {
    query: {
      queryKey: [...getListAdminNativeDeletionEmailsQueryKey(params), user?.id],
      staleTime: 0,
      gcTime: 0,
      refetchOnMount: 'always',
      refetchInterval: 60_000,
      retry: false,
    },
  });
  return (
    <section className="admin-card admin-section" aria-labelledby="admin-native-deletion-emails-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="admin-eyebrow">Read-only · iPhone deletion receipts</p>
          <h2 id="admin-native-deletion-emails-heading" className="admin-display admin-section-title mt-1">Deletion confirmation emails</h2>
        </div>
        <button type="button" className="admin-button" data-testid="button-refresh-deletion-emails" disabled={query.isFetching} onClick={() => void query.refetch()}>
          <RefreshCw className="h-4 w-4" /> Refresh email status
        </button>
      </div>
      <p className="mt-3 max-w-3xl text-sm leading-relaxed text-[#60778a]">
        Mail-stage visibility only, not a cleanup alert. References remain after identities are deleted.
        Recipient addresses and deleted profiles are never shown. Provider acceptance does not confirm delivery or reading.
        This view cannot resend email, restore data, or reactivate access. Status refreshes every minute while open.
      </p>
      {query.isLoading ? <p className="mt-5 text-sm" role="status" data-testid="status-deletion-emails-loading">Loading deletion email status…</p>
        : query.isError ? <div className="admin-error mt-5" role="alert" data-testid="status-deletion-emails-error">Deletion email status could not be loaded or access could not be verified. No records are shown. Use Refresh email status to retry.</div>
        : !query.data ? <p className="mt-5 text-sm" role="status">No email status response is available.</p>
        : <>
          {query.data.items.length ? <AdminNativeDeletionEmailRows items={query.data.items} />
            : <p className="mt-5 text-sm" role="status">{offset ? 'No deletion records on this page.' : 'No native deletion requests yet.'}</p>}
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-[#60778a]" role="status" data-testid="status-deletion-emails-page">{query.data.total} deletion records · Page {Math.floor(offset / PAGE_SIZE) + 1}</p>
            <div className="flex gap-2">
              <button type="button" className="admin-button" data-testid="button-previous-deletion-emails" disabled={offset === 0 || query.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>Previous email statuses</button>
              <button type="button" className="admin-button" data-testid="button-next-deletion-emails" disabled={offset + PAGE_SIZE >= query.data.total || query.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)}>Next email statuses</button>
            </div>
          </div>
        </>}
    </section>
  );
}
