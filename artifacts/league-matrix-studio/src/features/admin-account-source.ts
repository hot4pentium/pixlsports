import type { AdminMember } from '@workspace/api-client-react';

export function accountSourceLabel(member: Pick<AdminMember, 'accountSource'>) {
  return member.accountSource === 'native_ios' ? 'iPhone-only account'
    : member.accountSource === 'legacy_linked' ? 'PWA + linked iPhone' : 'PWA account';
}
