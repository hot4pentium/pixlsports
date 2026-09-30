type PublicSupportLinkProps = {
  variant?: "dark" | "light";
  placement?: "footer" | "header";
};

export function PublicSupportLink({ variant = "dark", placement = "footer" }: PublicSupportLinkProps) {
  const dark = variant === "dark";
  const colorClass = dark
    ? "border-white/20 text-white/70 hover:border-white/50 hover:text-white focus-visible:outline-primary"
    : "border-[#d7e0eb] text-[#52657a] hover:border-[#2474f5] hover:text-[#0b1f3a] focus-visible:outline-[#2474f5]";

  if (placement === "header") {
    return (
      <a
        href="mailto:support@pixlsports.com"
        aria-label="Email Pixl Sports support at support@pixlsports.com"
        data-testid="link-public-support-header"
        className={`inline-flex min-h-11 shrink-0 items-center justify-center border px-3 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${colorClass}`}
      >
        Support
      </a>
    );
  }

  return (
    <footer
      className={`border-t px-5 py-3 text-center text-[10px] font-bold uppercase tracking-[0.14em] ${
        dark ? "border-white/10 text-white/50" : "border-[#e6ebf2] text-[#52657a]"
      }`}
    >
      <p>
        Need help?{" "}
        <a
          href="mailto:support@pixlsports.com"
          aria-label="Email Pixl Sports support at support@pixlsports.com"
          data-testid="link-public-support-email"
          className={`inline-flex min-h-11 items-center underline underline-offset-4 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
            dark
              ? "text-primary hover:text-white focus-visible:outline-primary"
              : "text-[#2474f5] hover:text-[#0b1f3a] focus-visible:outline-[#2474f5]"
          }`}
        >
          support@pixlsports.com
        </a>
      </p>
    </footer>
  );
}