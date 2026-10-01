import React, { useState, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

export type AuditMemberOption = {
  clerkUserId: string;
  firstName: string | null;
  lastName: string | null;
  primaryEmailAddress: string | null;
  profile: { displayName: string | null };
};

type AdminAuditMemberFilterProps = {
  searchText: string;
  selectedMember: AuditMemberOption | null;
  members: AuditMemberOption[];
  isSearching: boolean;
  searchError: boolean;
  onSearchTextChange: (value: string) => void;
  onSelectMember: (member: AuditMemberOption) => void;
  onClearSelection: () => void;
};

const MAX_VISIBLE_MEMBERS = 10;
const MEMBER_OPTIONS_ID = 'admin-audit-member-options';

function memberName(member: AuditMemberOption) {
  return [member.firstName, member.lastName].filter(Boolean).join(' ')
    || member.profile.displayName
    || 'Unnamed member';
}

export function AdminAuditMemberFilter({
  searchText,
  selectedMember,
  members,
  isSearching,
  searchError,
  onSearchTextChange,
  onSelectMember,
  onClearSelection,
}: AdminAuditMemberFilterProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const query = searchText.trim();
  const visibleMembers = members.slice(0, MAX_VISIBLE_MEMBERS);
  const showOptions = !selectedMember && query.length >= 2 && !isSearching && !searchError && visibleMembers.length > 0;

  const selectMember = (member: AuditMemberOption) => {
    setActiveIndex(0);
    onSelectMember(member);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      onSearchTextChange('');
      setActiveIndex(0);
      return;
    }

    if (!showOptions) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, visibleMembers.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const activeMember = visibleMembers[activeIndex];
      if (activeMember) selectMember(activeMember);
    }
  };

  return (
    <div className="relative">
      <span className="admin-label block">Affected member</span>
      {selectedMember ? (
        <div className="flex min-h-11 items-center justify-between gap-2 border border-[#c9d6d1] bg-white px-3 py-2">
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold text-[#16334b]">{memberName(selectedMember)}</span>
            <span className="block truncate text-xs text-[#60778a]">{selectedMember.primaryEmailAddress || 'No email address'}</span>
          </span>
          <button
            className="admin-button !min-h-8 !px-2"
            type="button"
            onClick={onClearSelection}
            aria-label={`Clear selected member ${memberName(selectedMember)}`}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <>
          <input
            className="admin-input"
            type="search"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={showOptions}
            aria-controls={showOptions ? MEMBER_OPTIONS_ID : undefined}
            aria-activedescendant={showOptions ? `${MEMBER_OPTIONS_ID}-${activeIndex}` : undefined}
            autoComplete="off"
            maxLength={200}
            value={searchText}
            onChange={(event) => {
              setActiveIndex(0);
              onSearchTextChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search name or email"
          />
          {query.length < 2 ? (
            <p className="mt-1 text-[11px] text-[#60778a]">Enter at least 2 characters to search by name or email.</p>
          ) : isSearching ? (
            <p className="mt-1 text-[11px] text-[#60778a]" role="status">Searching members…</p>
          ) : searchError ? (
            <p className="mt-1 text-[11px] text-[#a33e25]" role="alert">Members could not be searched. Try again in a moment.</p>
          ) : visibleMembers.length === 0 ? (
            <p className="mt-1 text-[11px] text-[#60778a]" role="status">No members found. Try a different name or email.</p>
          ) : (
            <ul
              id={MEMBER_OPTIONS_ID}
              className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto border border-[#c9d6d1] bg-white shadow-lg"
              role="listbox"
              aria-label="Matching members"
            >
              {visibleMembers.map((member, index) => (
                <li
                  id={`${MEMBER_OPTIONS_ID}-${index}`}
                  key={member.clerkUserId}
                  className={`cursor-pointer border-b border-[#e5ebe7] px-3 py-2 last:border-0 hover:bg-[#eef4ef] ${index === activeIndex ? 'bg-[#eef4ef]' : ''}`}
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => selectMember(member)}
                >
                  <span className="block truncate text-sm font-bold text-[#16334b]">{memberName(member)}</span>
                  <span className="block truncate text-xs text-[#60778a]">{member.primaryEmailAddress || 'No email address'}</span>
                </li>
              ))}
              {members.length > MAX_VISIBLE_MEMBERS && (
                <li className="px-3 py-2 text-[11px] text-[#60778a]" role="presentation">
                  Showing the first {MAX_VISIBLE_MEMBERS} matches. Refine your search to find another member.
                </li>
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}