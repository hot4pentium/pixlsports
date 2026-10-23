import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'wouter';

type BackNavigationLinkProps = {
  href: string;
  label: string;
  testId: string;
  variant?: 'default' | 'inverse' | 'public';
  className?: string;
};

const variantClasses = {
  default: 'text-foreground/75 hover:text-foreground focus-visible:ring-primary focus-visible:ring-offset-background',
  inverse: 'text-white/75 hover:text-white focus-visible:ring-white focus-visible:ring-offset-[#0B1F3A]',
  public: 'text-[#b9cadd] hover:text-[#f7c97a] focus-visible:ring-[#f7c97a] focus-visible:ring-offset-[#0b2039]',
} satisfies Record<NonNullable<BackNavigationLinkProps['variant']>, string>;

export function BackNavigationLink({
  href,
  label,
  testId,
  variant = 'default',
  className = '',
}: BackNavigationLinkProps) {
  return (
    <Link
      href={href}
      className={`group inline-flex min-h-11 w-fit items-center gap-2 rounded-sm border border-current/30 px-3 py-2 text-[11px] font-bold uppercase tracking-[.14em] transition-colors hover:border-current/65 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${variantClasses[variant]} ${className}`}
      data-testid={testId}
    >
      <ArrowLeft className="h-4 w-4 shrink-0 transition-transform group-hover:-translate-x-0.5" aria-hidden="true" />
      <span>{label}</span>
    </Link>
  );
}