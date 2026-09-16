import { createElement, Fragment, type ReactNode } from 'react';

import {
  getStudioDestination,
  getUserRole,
  type UserLike,
} from './supporter-dashboard-model';

export interface StudioRoleBoundaryProps {
  user: UserLike;
  isLoaded: boolean;
  isSignedIn: boolean;
  loading: ReactNode;
  signedOut: ReactNode;
  roleSelection: ReactNode;
  supporter: ReactNode;
  coach: ReactNode;
}

/**
 * Keeps the mounted studio experience derived from Clerk's current user
 * rather than from the role that was present on the first render.
 */
export function StudioRoleBoundary({
  user,
  isLoaded,
  isSignedIn,
  loading,
  signedOut,
  roleSelection,
  supporter,
  coach,
}: StudioRoleBoundaryProps) {
  if (!isLoaded) return createElement(Fragment, null, loading);
  if (!isSignedIn) return createElement(Fragment, null, signedOut);

  const destination = getStudioDestination(getUserRole(user));
  if (destination === 'role-selection') return createElement(Fragment, null, roleSelection);
  return destination === 'supporter'
    ? createElement(Fragment, null, supporter)
    : createElement(Fragment, null, coach);
}