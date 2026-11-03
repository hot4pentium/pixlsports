type BrandLogoProps = {
  variant?: 'on-light' | 'on-dark';
  className?: string;
  alt?: string;
};

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function BrandLogo({
  variant = 'on-light',
  className,
  alt = 'Pixl Sports',
}: BrandLogoProps) {
  const filename = variant === 'on-dark'
    ? 'pixlsports-logo-on-dark.png'
    : 'pixlsports-logo.png';

  return (
    <img
      src={`${basePath}/${filename}`}
      alt={alt}
      className={className}
    />
  );
}
