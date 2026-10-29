import Link from 'next/link';
import Image from 'next/image';

/**
 * Clickable Aetheris banner used as the app's home link.
 */
export default function HeaderBrand({
  size = 24
}: {
  size?: number;
}) {
  return (
    <Link
      href="/"
      aria-label="Aetheris AI home"
      className="inline-flex shrink-0 items-center rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
    >
      <Image
        src="/aetheris-banner.png"
        alt="Aetheris AI"
        width={Math.round(size * 3.5)}
        height={size}
        priority
        className="h-auto w-auto"
      />
    </Link>
  );
}
