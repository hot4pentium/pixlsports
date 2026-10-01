import {
  getGetAdminMemberQueryKey,
  getGetAdminSessionQueryKey,
  getListAdminAuditQueryKey,
  getListAdminMembersQueryKey,
  useDeleteAdminMember,
  useGetAdminMember,
  useGetAdminSession,
  useListAdminAudit,
  useListAdminMembers,
  useUpdateAdminMemberProfile,
  useUpdateAdminMemberAdministrator,
  useUpdateAdminMemberSuspension,
  type AdminMember,
  type AdminMemberProfileUpdate,
  type AdminMemberActionResult,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronLeft, ChevronRight, RefreshCw, Search, ShieldCheck, ShieldOff, Trash2, UserRound, X } from 'lucide-react';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useUser } from '@clerk/react';
import { Link, useLocation } from 'wouter';

import { AdminAuditMemberFilter, type AuditMemberOption } from './admin-audit-member-filter';
import './admin-console.css';

const PAGE_SIZE = 20;
const AUDIT_SIZE = 50;
const AUDIT_ACTIONS = [
  ['initial_admin_bootstrapped', 'Initial administrator setup'],
  ['profile_updated', 'Profile updated'],
  ['account_suspended', 'Account suspended'],
  ['account_reactivated', 'Account reactivated'],
  ['account_deleted', 'Account deleted'],
  ['administrator_granted', 'Administrator access granted'],
  ['administrator_revoked', 'Administrator access revoked'],
] as const;
const AUDIT_STATUSES = ['pending', 'failed', 'completed'] as const;
type AuditAction = (typeof AUDIT_ACTIONS)[number][0];
type AuditStatus = (typeof AUDIT_STATUSES)[number];
type AuditFilters = {
  memberClerkUserId: string;
  action: AuditAction | '';
  status: AuditStatus | '';
  fromDate: string;
  toDate: string;
};
const EMPTY_AUDIT_FILTERS: AuditFilters = {
  memberClerkUserId: '',
  action: '',
  status: '',
  fromDate: '',
  toDate: '',
};
const PROFILE_FIELDS: { key: keyof AdminMemberProfileUpdate; label: string; type?: string }[] = [
  { key: 'displayName', label: 'Display name' },
  { key: 'teamName', label: 'Team name' },
  { key: 'seasonName', label: 'Season' },
  { key: 'athleteName', label: 'Athlete name' },
  { key: 'jerseyNumber', label: 'Jersey number' },
  { key: 'position', label: 'Position' },
  { key: 'relationship', label: 'Relationship' },
];

function formatDate(value?: string | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Not available' : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function fullName(member: AdminMember) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ') || member.profile.displayName || 'Unnamed member';
}

function statusLabel(value: string) {
  return value.replaceAll('_', ' ');
}

function AdminAuditHistory() {
  const [offset, setOffset] = useState(0);
  const [draftFilters, setDraftFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [memberSearchInput, setMemberSearchInput] = useState('');
  const [memberSearch, setMemberSearch] = useState('');
  const [selectedMember, setSelectedMember] = useState<AuditMemberOption | null>(null);
  const memberParams = useMemo(() => ({
    search: memberSearch || undefined,
    limit: 50,
    offset: 0,
  }), [memberSearch]);
  const memberResults = useListAdminMembers(memberParams, {
    query: {
      enabled: memberSearch.length >= 2 && !selectedMember,
      queryKey: getListAdminMembersQueryKey(memberParams),
      staleTime: 0,
    },
  });
  const params = useMemo(() => ({
    limit: AUDIT_SIZE,
    offset,
    ...(appliedFilters.memberClerkUserId ? { memberClerkUserId: appliedFilters.memberClerkUserId } : {}),
    ...(appliedFilters.action ? { action: appliedFilters.action } : {}),
    ...(appliedFilters.status ? { status: appliedFilters.status } : {}),
    ...(appliedFilters.fromDate ? { fromDate: appliedFilters.fromDate } : {}),
    ...(appliedFilters.toDate ? { toDate: appliedFilters.toDate } : {}),
  }), [offset, appliedFilters]);
  const audit = useListAdminAudit(params, {
    query: { queryKey: getListAdminAuditQueryKey(params), staleTime: 0, refetchOnMount: 'always' },
  });
  const activeFilterCount = Object.values(appliedFilters).filter(Boolean).length;
  const invalidDateRange = Boolean(draftFilters.fromDate && draftFilters.toDate && draftFilters.fromDate > draftFilters.toDate);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const trimmed = memberSearchInput.trim();
      setMemberSearch(trimmed.length >= 2 ? trimmed : '');
    }, 250);
    return () => window.clearTimeout(timer);
  }, [memberSearchInput]);

  const applyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (invalidDateRange) return;
    const nextFilters = {
      ...draftFilters,
      memberClerkUserId: draftFilters.memberClerkUserId.trim(),
    };
    setDraftFilters(nextFilters);
    setAppliedFilters(nextFilters);
    setOffset(0);
  };

  const clearFilters = () => {
    setDraftFilters(EMPTY_AUDIT_FILTERS);
    setAppliedFilters(EMPTY_AUDIT_FILTERS);
    setSelectedMember(null);
    setMemberSearchInput('');
    setOffset(0);
  };

  const clearMemberSelection = () => {
    setSelectedMember(null);
    setMemberSearchInput('');
    setDraftFilters((current) => ({ ...current, memberClerkUserId: '' }));
    setAppliedFilters((current) => ({ ...current, memberClerkUserId: '' }));
    setOffset(0);
  };

  const updateMemberSearch = (value: string) => {
    setMemberSearchInput(value);
    setSelectedMember(null);
    setDraftFilters((current) => ({ ...current, memberClerkUserId: '' }));
  };

  return (
    <section className="admin-card admin-section" aria-labelledby="admin-audit-heading">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="admin-eyebrow">Accountability log</p>
          <h2 id="admin-audit-heading" className="admin-display admin-section-title mt-1">Recent actions</h2>
        </div>
        <button type="button" className="admin-button" onClick={() => void audit.refetch()} aria-label="Refresh audit history">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>
      <form className="mt-5 border border-[#e5ebe7] bg-white/70 p-4" onSubmit={applyFilters} aria-label="Filter audit history">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <AdminAuditMemberFilter
            searchText={memberSearchInput}
            selectedMember={selectedMember}
            members={memberSearchInput.trim() === memberSearch && memberSearch.length >= 2
              ? memberResults.data?.items ?? []
              : []}
            isSearching={memberSearchInput.trim().length >= 2
              && (memberSearchInput.trim() !== memberSearch || memberResults.isLoading || memberResults.isFetching)}
            searchError={memberSearchInput.trim() === memberSearch && memberResults.isError}
            onSearchTextChange={updateMemberSearch}
            onSelectMember={(member) => {
              setSelectedMember(member);
              setMemberSearchInput('');
              setDraftFilters((current) => ({ ...current, memberClerkUserId: member.clerkUserId }));
            }}
            onClearSelection={clearMemberSelection}
          />
          <label>
            <span className="admin-label">Action</span>
            <select
              className="admin-input"
              value={draftFilters.action}
              onChange={(event) => setDraftFilters((current) => ({ ...current, action: event.target.value as AuditFilters['action'] }))}
            >
              <option value="">All actions</option>
              {AUDIT_ACTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label>
            <span className="admin-label">Status</span>
            <select
              className="admin-input"
              value={draftFilters.status}
              onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value as AuditFilters['status'] }))}
            >
              <option value="">All statuses</option>
              {AUDIT_STATUSES.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
            </select>
          </label>
          <label>
            <span className="admin-label">From date (UTC)</span>
            <input
              className="admin-input"
              type="date"
              value={draftFilters.fromDate}
              max={draftFilters.toDate || undefined}
              onChange={(event) => setDraftFilters((current) => ({ ...current, fromDate: event.target.value }))}
            />
          </label>
          <label>
            <span className="admin-label">To date (UTC)</span>
            <input
              className="admin-input"
              type="date"
              value={draftFilters.toDate}
              min={draftFilters.fromDate || undefined}
              onChange={(event) => setDraftFilters((current) => ({ ...current, toDate: event.target.value }))}
            />
          </label>
        </div>
        <p className="mt-2 text-[11px] text-[#60778a]">Member filters match the affected account. Date limits include the full selected UTC dates.</p>
        {invalidDateRange && <p className="mt-2 text-xs font-semibold text-[#a33e25]" role="alert">The start date must be on or before the end date.</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <button className="admin-button admin-button-primary" type="submit" disabled={invalidDateRange || audit.isFetching}>
            <Search className="h-4 w-4" /> Apply filters
          </button>
          <button className="admin-button" type="button" onClick={clearFilters} disabled={audit.isFetching && activeFilterCount === 0 && offset === 0}>
            Clear filters
          </button>
          {activeFilterCount > 0 && <span className="self-center text-xs text-[#60778a]">{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} applied</span>}
        </div>
      </form>
      {audit.isLoading ? (
        <div className="mt-6 space-y-4" aria-label="Loading audit history" role="status">
          {[0, 1, 2].map((key) => <div className="admin-skeleton" key={key} />)}
        </div>
      ) : audit.isError ? (
        <div className="admin-error mt-5" role="alert">
          Audit history could not load. <button className="font-bold underline" type="button" onClick={() => void audit.refetch()}>Try again</button>
        </div>
      ) : !audit.data?.items.length ? (
        <div className="mt-6 border border-dashed border-[#c9d6d1] px-4 py-8 text-center" role="status" aria-live="polite">
          <ShieldCheck className="mx-auto h-6 w-6 text-[#2868a0]" />
          {activeFilterCount > 0 ? (
            <>
              <p className="mt-2 text-sm font-bold">No audit entries match these filters</p>
              <p className="mt-1 text-xs text-[#60778a]">Try a different member, action, status, or date range.</p>
              <button className="admin-button mt-3" type="button" onClick={clearFilters}>Clear filters</button>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm font-bold">No admin actions recorded</p>
              <p className="mt-1 text-xs text-[#60778a]">New member operations will appear here.</p>
            </>
          )}
        </div>
      ) : (
        <ol className="mt-6" aria-label="Audit history entries">
          {audit.data.items.map((entry) => (
            <li className="admin-timeline-item" key={entry.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-extrabold uppercase tracking-[.08em]">{statusLabel(entry.action)}</span>
                <span className={`admin-chip ${entry.status === 'failed' ? 'admin-chip-danger' : entry.status === 'pending' ? 'admin-chip-warn' : ''}`}>{entry.status}</span>
              </div>
              <p className="mt-1 text-xs text-[#60778a]">Actor <span className="font-semibold text-[#16334b]">{entry.actorClerkUserId}</span> · Target <span className="font-semibold text-[#16334b]">{entry.targetClerkUserId}</span></p>
              {entry.changedFields.length > 0 && <p className="mt-1 text-xs text-[#60778a]">Changed: {entry.changedFields.join(', ')}</p>}
              {entry.reason && <p className="mt-1 text-xs leading-relaxed text-[#39566b]">Reason: {entry.reason}</p>}
              {entry.failureCode && <p className="mt-1 text-xs font-bold text-[#a33e25]">Failure code: {entry.failureCode}. If the member remains available, review the cause and retry the deletion from their record.</p>}
              <p className="admin-mono mt-2 text-[10px] text-[#82939d]">Started {formatDate(entry.createdAt)}{entry.completedAt ? ` · Finished ${formatDate(entry.completedAt)}` : ''}</p>
            </li>
          ))}
        </ol>
      )}
      {audit.data && audit.data.totalCount > audit.data.items.length && (
        <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#e5ebe7] pt-3">
          <p className="text-xs text-[#60778a]">Showing {offset + 1}–{Math.min(offset + audit.data.items.length, audit.data.totalCount)} of {audit.data.totalCount} matching actions</p>
          <div className="flex gap-2">
            <button className="admin-button !min-h-8 !px-2" type="button" disabled={offset <= 0 || audit.isFetching} onClick={() => setOffset(Math.max(0, offset - AUDIT_SIZE))} aria-label="Previous audit page"><ChevronLeft className="h-4 w-4" /></button>
            <button className="admin-button !min-h-8 !px-2" type="button" disabled={offset + AUDIT_SIZE >= audit.data.totalCount || audit.isFetching} onClick={() => setOffset(offset + AUDIT_SIZE)} aria-label="Next audit page"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </section>
  );
}

function MemberDetail({ userId, onClose, onMutated }: { userId: string; onClose: () => void; onMutated: () => void }) {
  const { user } = useUser();
  const queryClient = useQueryClient();
  const detail = useGetAdminMember(userId, {
    query: { enabled: Boolean(userId), queryKey: getGetAdminMemberQueryKey(userId), staleTime: 0, refetchOnMount: 'always' },
  });
  const profileMutation = useUpdateAdminMemberProfile();
  const administratorMutation = useUpdateAdminMemberAdministrator();
  const suspensionMutation = useUpdateAdminMemberSuspension();
  const deleteMutation = useDeleteAdminMember();
  const member = detail.data;
  const [profile, setProfile] = useState<AdminMemberProfileUpdate>({});
  const [reason, setReason] = useState('');
  const [administratorReason, setAdministratorReason] = useState('');
  const [administratorMessage, setAdministratorMessage] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [actionError, setActionError] = useState('');
  const [profileSaved, setProfileSaved] = useState(false);
  const [lastDeletion, setLastDeletion] = useState<AdminMemberActionResult | null>(null);
  const protectedTarget = Boolean(member && (member.clerkUserId === user?.id || member.isAdministrator));
  const failedDeletion = useListAdminAudit({ limit: AUDIT_SIZE, offset: 0 }, {
    query: { queryKey: getListAdminAuditQueryKey({ limit: AUDIT_SIZE, offset: 0 }), staleTime: 0 },
  });
  const previousDeletionRequest = failedDeletion.data?.items.find((entry) => entry.targetClerkUserId === userId && entry.action === 'account_deleted' && entry.status !== 'completed');

  useEffect(() => {
    if (!member) return;
    setProfile({
      displayName: member.profile.displayName,
      teamName: member.profile.teamName,
      seasonName: member.profile.seasonName,
      athleteName: member.profile.athleteName,
      jerseyNumber: member.profile.jerseyNumber,
      position: member.profile.position,
      relationship: member.profile.relationship,
      sport: member.profile.sport,
    });
  }, [member]);

  const refreshAfterMutation = () => {
    void queryClient.invalidateQueries({ queryKey: getGetAdminMemberQueryKey(userId) });
    void queryClient.invalidateQueries({ queryKey: getListAdminMembersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminAuditQueryKey() });
    onMutated();
  };

  const submitProfile = (event: FormEvent) => {
    event.preventDefault();
    if (!member) return;
    setActionError('');
    setProfileSaved(false);
    profileMutation.mutate({ userId, data: { ...profile } }, {
      onSuccess: () => { setProfileSaved(true); refreshAfterMutation(); },
      onError: () => setActionError('Profile changes were not saved. Refresh this record and try again.'),
    });
  };

  const setSuspension = (suspended: boolean) => {
    if (!member || protectedTarget) return;
    setActionError('');
    suspensionMutation.mutate({ userId, data: { suspended, reason: reason.trim() || null } }, {
      onSuccess: () => { setReason(''); refreshAfterMutation(); },
      onError: () => setActionError(`Could not ${suspended ? 'suspend' : 'reactivate'} this member. Their current access has not been changed.`),
    });
  };

  const setAdministratorAccess = (administrator: boolean) => {
    if (!member || member.clerkUserId === user?.id) return;
    if (!administrator && !window.confirm(`Remove administrator access from ${fullName(member)}? They will no longer be able to manage member records.`)) return;
    setActionError('');
    setAdministratorMessage('');
    administratorMutation.mutate({ userId, data: { administrator, reason: administratorReason.trim() || null } }, {
      onSuccess: (result) => {
        setAdministratorMessage(result.message);
        setAdministratorReason('');
        refreshAfterMutation();
      },
      onError: () => {
        setActionError(`Could not ${administrator ? 'grant' : 'remove'} administrator access. No confirmed change was saved; refresh the member and audit history before retrying.`);
        refreshAfterMutation();
      },
    });
  };

  const deleteMember = (event: FormEvent) => {
    event.preventDefault();
    if (!member || protectedTarget || confirmText !== userId || reason.trim().length < 3) return;
    setActionError('');
    deleteMutation.mutate({ userId, data: { confirmationText: confirmText, reason: reason.trim() } }, {
      onSuccess: (result) => {
        setLastDeletion(result);
        setConfirmText('');
        setReason('');
        refreshAfterMutation();
      },
      onError: () => {
        setActionError('Deletion request failed before a confirmed result. Refresh the member and audit history before deciding whether to retry.');
        refreshAfterMutation();
      },
    });
  };

  if (detail.isLoading) return <section className="admin-card admin-section" aria-label="Loading member record"><div className="admin-skeleton w-1/3" /><div className="mt-4 admin-skeleton w-2/3" /></section>;
  if (detail.isError || !member) return (
    <section className="admin-card admin-section" role="alert">
      <div className="admin-error">This member record could not be loaded.</div>
      <div className="mt-4 flex gap-2"><button className="admin-button" type="button" onClick={() => void detail.refetch()}>Try again</button><button className="admin-button" type="button" onClick={onClose}>Close</button></div>
    </section>
  );
  return (
    <section className="admin-card admin-section" aria-labelledby="member-record-heading">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Member record</p>
          <h2 id="member-record-heading" className="admin-display admin-section-title mt-1">{fullName(member)}</h2>
          <p className="mt-2 break-all text-sm text-[#60778a]">{member.primaryEmailAddress || 'No email on record'}</p>
        </div>
        <button className="admin-button !min-h-9 !px-2.5" type="button" onClick={onClose} aria-label="Close member record"><X className="h-4 w-4" /></button>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <span className={`admin-chip ${member.adminSuspended ? 'admin-chip-danger' : ''}`}>{member.adminSuspended ? 'Admin suspended' : 'Access available'}</span>
        <span className="admin-chip">{statusLabel(member.lifecycleStatus)}</span>
        <span className="admin-chip">{member.accessMode ?? 'Access mode unknown'}</span>
        {protectedTarget && <span className="admin-chip admin-chip-warn">Protected administrator account</span>}
      </div>
      {lastDeletion && (
        <div className={`mt-5 border p-4 ${lastDeletion.status === 'failed' ? 'border-[#e2b7aa] bg-[#fff2ed]' : lastDeletion.status === 'pending' ? 'border-[#e5c3a8] bg-[#fff8ed]' : 'border-[#cbded2] bg-[#f2f8f2]'}`} role="status">
          <p className="text-[10px] font-extrabold uppercase tracking-[.15em]">Deletion {lastDeletion.status}</p>
          <p className="mt-1 text-sm">{lastDeletion.message}</p>
          <p className="mt-1 break-all text-[10px] text-[#60778a]">Action {lastDeletion.actionId} · {lastDeletion.targetClerkUserId}</p>
        </div>
      )}
      {previousDeletionRequest && (
        <div className="mt-5 border border-[#e2b7aa] bg-[#fff7f3] p-4">
          <p className="text-xs font-extrabold uppercase text-[#a33e25]">Deletion {previousDeletionRequest.status}</p>
          <p className="mt-1 text-xs">{previousDeletionRequest.status === 'failed' ? `Failure code: ${previousDeletionRequest.failureCode || 'Not provided'}. Review the recorded reason before retrying.` : 'Cleanup is queued or running and will retry automatically if a step fails.'} · Started {formatDate(previousDeletionRequest.createdAt)}.</p>
        </div>
      )}
      {actionError && <div className="admin-error mt-5" role="alert">{actionError}</div>}

      <form className="mt-7" onSubmit={submitProfile}>
        <div className="mb-4 flex items-end justify-between gap-3">
          <div><p className="admin-eyebrow">Pixl Sports profile</p><h3 className="admin-display mt-1 text-2xl uppercase">App profile</h3></div>
          <button type="submit" className="admin-button admin-button-primary" disabled={profileMutation.isPending}>{profileMutation.isPending ? 'Saving…' : 'Save profile'}</button>
        </div>
        <div className="admin-fields">
          {PROFILE_FIELDS.map(({ key, label }) => (
            <label key={key}><span className="admin-label">{label}</span><input className="admin-input" maxLength={key === 'jerseyNumber' ? 20 : key === 'position' || key === 'relationship' ? 60 : 100} value={String(profile[key] ?? '')} onChange={(event) => setProfile((current) => ({ ...current, [key]: event.target.value || null }))} /></label>
          ))}
          <label><span className="admin-label">Sport</span><select className="admin-input" value={profile.sport ?? ''} onChange={(event) => setProfile((current) => ({ ...current, sport: (event.target.value || null) as AdminMemberProfileUpdate['sport'] }))}>
            <option value="">Not set</option><option value="baseball">Baseball</option><option value="basketball">Basketball</option><option value="football">Football</option><option value="soccer">Soccer</option><option value="volleyball">Volleyball</option>
          </select></label>
        </div>
        {profileSaved && <p className="mt-3 flex items-center gap-2 text-xs font-bold text-[#2868a0]" role="status"><Check className="h-4 w-4" />Profile saved and refreshed from the server.</p>}
      </form>

      <section className="mt-8 border-t border-[#d5dfda] pt-6" aria-labelledby="administrator-access-heading">
        <p className="admin-eyebrow">Administrator controls</p>
        <h3 id="administrator-access-heading" className="admin-display mt-1 text-2xl uppercase">Administrator access</h3>
        <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#60778a]">Administrators can review and manage member records. Changes are recorded in the accountability log and are available only in Production.</p>
        {member.clerkUserId === user?.id ? (
          <p className="mt-3 border border-[#ead2b7] bg-[#fff9ef] p-3 text-sm text-[#795327]">You cannot change your own administrator access. Ask another administrator to manage your role.</p>
        ) : (
          <>
            <label className="mt-4 block"><span className="admin-label">Reason (optional)</span><textarea className="admin-input min-h-20 resize-y" maxLength={500} value={administratorReason} onChange={(event) => setAdministratorReason(event.target.value)} /></label>
            <button
              type="button"
              className={`admin-button mt-3 ${member.isAdministrator ? 'admin-button-danger' : 'admin-button-primary'}`}
              disabled={administratorMutation.isPending}
              onClick={() => setAdministratorAccess(!member.isAdministrator)}
            >
              {member.isAdministrator ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
              {administratorMutation.isPending ? 'Updating administrator access…' : member.isAdministrator ? 'Remove administrator access' : 'Grant administrator access'}
            </button>
          </>
        )}
        {administratorMessage && <p className="mt-3 text-xs font-bold text-[#2868a0]" role="status">{administratorMessage}</p>}
      </section>

      <div className="mt-8 border-t border-[#d5dfda] pt-6">
        <p className="admin-eyebrow">Access controls</p>
        <h3 className="admin-display mt-1 text-2xl uppercase">Member access</h3>
          {protectedTarget ? (
          <p className="mt-3 border border-[#ead2b7] bg-[#fff9ef] p-3 text-sm text-[#795327]">Administrative accounts cannot be suspended or deleted from this workspace.</p>
        ) : (
          <>
            <label className="mt-4 block"><span className="admin-label">Reason (optional for access change; required for deletion)</span><textarea className="admin-input min-h-20 resize-y" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} /></label>
              {member.lifecycleStatus === 'not_provisioned' ? (
                <p className="mt-3 border border-[#d5dfda] bg-[#f4f7f3] p-3 text-sm text-[#39566b]">This sign-in does not have a Pixl Sports app account, so an app-level suspension cannot be applied.</p>
              ) : member.lifecycleStatus === 'deletion_pending' ? (
                <p className="mt-3 border border-[#e5c3a8] bg-[#fff8ed] p-3 text-sm text-[#795327]">Access changes are disabled while account cleanup is pending.</p>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  {member.adminSuspended ? (
                    <button type="button" className="admin-button admin-button-primary" disabled={suspensionMutation.isPending} onClick={() => setSuspension(false)}><ShieldCheck className="h-4 w-4" />{suspensionMutation.isPending ? 'Reactivating…' : 'Reactivate access'}</button>
                  ) : (
                    <button type="button" className="admin-button" disabled={suspensionMutation.isPending} onClick={() => setSuspension(true)}><ShieldOff className="h-4 w-4" />{suspensionMutation.isPending ? 'Suspending…' : 'Suspend access'}</button>
                  )}
                </div>
              )}
            <form className="mt-6 border-t border-[#e3e9e5] pt-5" onSubmit={deleteMember}>
              <div className="flex items-center gap-2 text-[#a33e25]"><AlertTriangle className="h-4 w-4" /><p className="text-xs font-extrabold uppercase tracking-[.12em]">Permanent deletion</p></div>
              <p className="mt-2 max-w-2xl text-xs leading-relaxed text-[#60778a]">This cannot be undone. Enter the member’s exact account ID and provide a reason of at least 3 characters. Failed or pending outcomes are recorded in the audit history.</p>
              <label className="mt-4 block"><span className="admin-label">Type exact account ID: {userId}</span><input className="admin-input admin-mono" autoComplete="off" spellCheck={false} value={confirmText} onChange={(event) => setConfirmText(event.target.value)} /></label>
              <button type="submit" className="admin-button admin-button-danger mt-3" disabled={deleteMutation.isPending || confirmText !== userId || reason.trim().length < 3}>
                <Trash2 className="h-4 w-4" />{deleteMutation.isPending ? 'Submitting deletion…' : previousDeletionRequest?.status === 'failed' || member.lifecycleStatus === 'deletion_pending' ? 'Retry deletion cleanup' : 'Request permanent deletion'}
              </button>
            </form>
          </>
        )}
      </div>
      <dl className="mt-7 grid gap-3 border-t border-[#d5dfda] pt-5 text-xs sm:grid-cols-2">
        <div><dt className="admin-label">Member since</dt><dd>{formatDate(member.createdAt)}</dd></div>
        <div><dt className="admin-label">Account role</dt><dd>{member.role ?? 'Not set'}</dd></div>
        <div className="sm:col-span-2"><dt className="admin-label">Account ID</dt><dd className="admin-mono break-all">{member.clerkUserId}</dd></div>
      </dl>
      <button type="button" className="mt-6 inline-flex items-center gap-2 text-xs font-bold text-[#60778a] hover:text-[#16334b]" onClick={() => void detail.refetch()}><RefreshCw className="h-3.5 w-3.5" />Refresh member from server</button>
    </section>
  );
}

export function AdminConsolePage() {
  const session = useGetAdminSession({ query: { queryKey: getGetAdminSessionQueryKey(), staleTime: 0, refetchOnMount: 'always', retry: false } });
  const [location, setLocation] = useLocation();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedId, setSelectedId] = useState('');
  const params = useMemo(() => ({ search: search || undefined, limit: PAGE_SIZE, offset }), [search, offset]);
  const list = useListAdminMembers(params, { query: { enabled: session.data?.isAdmin === true, queryKey: getListAdminMembersQueryKey(params), staleTime: 0, refetchOnMount: 'always' } });
  const queryClient = useQueryClient();

  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchInput.trim()); setOffset(0); }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  if (session.isLoading) return <div className="admin-console grid min-h-[70dvh] place-items-center"><div className="w-full max-w-md p-6"><p className="admin-eyebrow">Pixl Sports · Member operations</p><div className="admin-skeleton mt-4 h-8" /><div className="admin-skeleton mt-3 w-2/3" /></div></div>;
  if (session.isError) return <main className="admin-console grid min-h-[70dvh] place-items-center p-5"><section className="admin-card max-w-lg p-7"><p className="admin-eyebrow">Secure workspace</p><h1 className="admin-display mt-2 text-4xl uppercase">Access check unavailable</h1><p className="mt-3 text-sm text-[#60778a]">The server could not verify your administrator session. Member data remains hidden.</p><button className="admin-button admin-button-primary mt-5" type="button" onClick={() => void session.refetch()}>Retry access check</button></section></main>;
  if (!session.data?.isAdmin) return <main className="admin-console grid min-h-[70dvh] place-items-center p-5"><section className="admin-card max-w-lg p-7" role="status"><p className="admin-eyebrow">Restricted workspace</p><h1 className="admin-display mt-2 text-4xl uppercase">Administrator access required</h1><p className="mt-3 text-sm leading-relaxed text-[#60778a]">This member-operations area is available only to accounts the server identifies as administrators. The interface check is not an authorization boundary.</p><Link className="admin-button admin-button-primary mt-5" href="/studio"><ArrowLeft className="h-4 w-4" />Return to Studio</Link></section></main>;

  const closeDetail = () => { setSelectedId(''); if (location.includes('?')) setLocation('/studio/admin'); };
  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: getListAdminMembersQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getListAdminAuditQueryKey() });
  };
  return (
    <main className="admin-console flex-1">
      <div className="admin-wrap">
        <div className="admin-topline">
          <div>
            <p className="admin-eyebrow flex items-center gap-2"><ShieldCheck className="h-4 w-4" /> Pixl Sports Studio · Member operations</p>
            <h1 className="admin-display admin-heading mt-3">Member desk<span className="text-[#c65332]">.</span></h1>
          </div>
          <Link href="/studio" className="admin-button shrink-0"><ArrowLeft className="h-4 w-4" />Studio</Link>
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-[#60778a]">A careful view of the people behind each season. Profile edits affect Pixl Sports app data only; sign-in credentials are never shown or editable here.</p>
        <div className="admin-grid">
          <section className="admin-card admin-section" aria-labelledby="admin-members-heading">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div><p className="admin-eyebrow">Member directory</p><h2 id="admin-members-heading" className="admin-display admin-section-title mt-1">Members</h2></div>
              <div className="flex gap-2">
                <label className="relative min-w-[220px] flex-1"><span className="sr-only">Search members by name or email</span><Search className="absolute left-3 top-3 h-4 w-4 text-[#80929b]" /><input className="admin-input !pl-9" value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="Search name or email" /></label>
                <button className="admin-button !px-3" type="button" onClick={() => { setSearchInput(''); setSearch(''); setOffset(0); }} aria-label="Clear search"><X className="h-4 w-4" /></button>
              </div>
            </div>
            {list.isLoading ? <div className="mt-6 space-y-4" aria-label="Loading members">{[0, 1, 2, 3].map((i) => <div className="admin-skeleton" key={i} />)}</div>
              : list.isError ? <div className="admin-error mt-5" role="alert">Members could not be loaded. <button type="button" className="font-bold underline" onClick={() => void list.refetch()}>Retry</button></div>
              : list.data?.items.length ? (
                <>
                  <div className="admin-table-wrap mt-5">
                    <table className="admin-table">
                      <thead><tr><th scope="col">Member</th><th scope="col">Team / season</th><th scope="col">Access</th><th scope="col"><span className="sr-only">View member</span></th></tr></thead>
                      <tbody>
                        {list.data.items.map((member) => (
                          <tr key={member.clerkUserId} className={selectedId === member.clerkUserId ? 'bg-[#eef4ef]' : ''}>
                            <td><button type="button" className="admin-row-button" onClick={() => setSelectedId(member.clerkUserId)}>{fullName(member)}</button><p className="mt-1 max-w-[250px] truncate text-xs text-[#60778a]">{member.primaryEmailAddress || 'No email'}</p></td>
                            <td><span>{member.profile.teamName || 'Team not set'}</span><p className="mt-1 text-xs text-[#60778a]">{member.profile.seasonName || 'Season not set'}</p></td>
                            <td>{member.isAdministrator ? <span className="admin-chip admin-chip-warn">Administrator</span> : <span className={`admin-chip ${member.adminSuspended ? 'admin-chip-danger' : ''}`}>{member.adminSuspended ? 'Suspended' : statusLabel(member.lifecycleStatus)}</span>}</td>
                            <td><button className="admin-button !min-h-8 !px-2.5" type="button" onClick={() => setSelectedId(member.clerkUserId)} aria-label={`View ${fullName(member)}`}><ArrowRight className="h-4 w-4" /></button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-[#e5ebe7] pt-4">
                    <p className="text-xs text-[#60778a]">Showing {offset + 1}–{Math.min(offset + list.data.items.length, list.data.totalCount)} of {list.data.totalCount}</p>
                    <div className="flex gap-2">
                      <button className="admin-button !min-h-9 !px-3" type="button" disabled={offset <= 0 || list.isFetching} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} aria-label="Previous page"><ChevronLeft className="h-4 w-4" />Previous</button>
                      <button className="admin-button !min-h-9 !px-3" type="button" disabled={offset + PAGE_SIZE >= list.data.totalCount || list.isFetching} onClick={() => setOffset(offset + PAGE_SIZE)} aria-label="Next page">Next<ChevronRight className="h-4 w-4" /></button>
                    </div>
                  </div>
                </>
              ) : <div className="mt-6 border border-dashed border-[#c9d6d1] px-5 py-10 text-center"><UserRound className="mx-auto h-7 w-7 text-[#78918c]" /><p className="mt-3 font-bold">{search ? 'No members match that search' : 'No members to show'}</p><p className="mt-1 text-xs text-[#60778a]">{search ? 'Try a different name or email.' : 'Member records will appear when available.'}</p></div>}
            <button className="mt-5 inline-flex items-center gap-2 text-xs font-bold text-[#60778a] hover:text-[#16334b]" type="button" onClick={() => { void list.refetch(); refreshAll(); }}><RefreshCw className="h-3.5 w-3.5" />Refresh directory</button>
          </section>
          {selectedId ? <MemberDetail key={selectedId} userId={selectedId} onClose={closeDetail} onMutated={refreshAll} /> : (
            <section className="admin-card admin-section flex min-h-[280px] flex-col justify-between">
              <div><p className="admin-eyebrow">Member record</p><h2 className="admin-display mt-2 text-3xl uppercase">Select a member</h2><p className="mt-3 text-sm leading-relaxed text-[#60778a]">Open a row to review their Pixl Sports profile, manage access, and inspect current account status.</p></div>
              <div className="mt-8 border-t border-[#e5ebe7] pt-5"><p className="text-[10px] font-extrabold uppercase tracking-[.14em] text-[#60778a]">Guardrails</p><ul className="mt-2 space-y-2 text-xs text-[#39566b]"><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-[#2868a0]" />App profile fields only</li><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-[#2868a0]" />Reversible access suspension</li><li className="flex gap-2"><Check className="h-4 w-4 shrink-0 text-[#2868a0]" />Permanent deletion requires exact confirmation</li></ul></div>
            </section>
          )}
        </div>
        <div className="mt-6"><AdminAuditHistory /></div>
        <p className="mt-6 text-center text-[10px] font-semibold uppercase tracking-[.13em] text-[#82939d]">Administrative actions are authorized and recorded by the Pixl Sports server.</p>
      </div>
    </main>
  );
}

export function AdminEntryLink() {
  const { isSignedIn } = useUser();
  const admin = useGetAdminSession({ query: { enabled: Boolean(isSignedIn), queryKey: getGetAdminSessionQueryKey(), staleTime: 30_000, retry: false } });
  if (!isSignedIn || !admin.data?.isAdmin) return null;
  return <Link href="/studio/admin" className="shrink-0 border-b-4 border-transparent py-4 text-sm font-bold uppercase tracking-widest text-[#f3f6fa]/70 transition-colors hover:border-[#ff6433] hover:text-white" data-testid="link-toolbar-admin">Member admin</Link>;
}