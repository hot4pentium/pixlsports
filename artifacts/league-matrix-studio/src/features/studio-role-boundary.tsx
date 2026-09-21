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
  supporter: ReactNode;
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
  supporter,
}: StudioRoleBoundaryProps) {
  if (!isLoaded) return createElement(Fragment, null, loading);
  if (!isSignedIn) return createElement(Fragment, null, signedOut);

  getStudioDestination(getUserRole(user));
  return createElement(Fragment, null, supporter);
}