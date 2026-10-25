import { shadcn } from '@clerk/themes';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const appOrigin = ['pixlsports.com', 'www.pixlsports.com'].includes(window.location.hostname.toLowerCase())
  ? 'https://pixlsports.com'
  : window.location.origin;

export const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${appOrigin}${basePath}/pixlsports-logo.png`,
  },
  variables: {
    colorPrimary: "#55A4FF",
    colorForeground: "#F3F6FA",
    colorMutedForeground: "#B9CADC",
    colorDanger: "hsl(0 84% 60%)",
    colorBackground: "#102B4D",
    colorInput: "#0B1F3A",
    colorInputForeground: "#F3F6FA",
    colorNeutral: "#91ACC3",
    fontFamily: "'DM Sans', sans-serif",
    borderRadius: "0.375rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-[#102B4D] w-[440px] max-w-full overflow-hidden rounded-xl border border-[#55A4FF]/30 shadow-[0_24px_80px_rgba(0,8,25,.38)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "font-display text-3xl uppercase tracking-wide text-white",
    headerSubtitle: "text-sm font-medium text-[#B9CADC]",
    socialButtonsBlockButtonText: "text-xs font-bold uppercase tracking-wider text-white",
    formFieldLabel: "text-xs font-bold uppercase tracking-wider text-[#E0EDFA]",
    footerActionLink: "text-[#73B5FF] font-bold hover:underline",
    footerActionText: "text-sm font-medium text-[#B9CADC]",
    dividerText: "text-xs font-bold uppercase tracking-widest text-[#B9CADC]",
    identityPreviewEditButton: "text-[#73B5FF]",
    formFieldSuccessText: "text-[#73B5FF] text-xs",
    alertText: "text-sm font-medium",
    logoBox: "mb-3",
    logoImage: "h-10 max-w-[134px] object-contain",
    socialButtonsBlockButton: "h-12 rounded-md border border-[#91ACC3]/40 bg-white/5 hover:bg-white/10 transition-colors text-white",
    formButtonPrimary: "h-12 rounded-md font-bold bg-[#55A4FF] !text-[#0B1F3A] hover:!bg-[#82BDFF] transition-colors",
    formFieldInput: "h-12 rounded-md border border-[#91ACC3]/40 bg-[#0B1F3A] text-white font-medium focus:border-[#55A4FF] focus:ring-1 focus:ring-[#55A4FF] transition-all",
    footerAction: "mt-4",
    dividerLine: "bg-white/20",
    alert: "rounded-md border border-destructive/30 bg-destructive/10 text-white",
    otpCodeFieldInput: "rounded-md border border-[#91ACC3]/40 bg-[#0B1F3A] text-white focus:border-[#55A4FF]",
    formFieldRow: "mb-3",
    main: "p-6 sm:p-8",
  },
};
