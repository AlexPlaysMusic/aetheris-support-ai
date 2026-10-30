import Link from 'next/link';
import Image from 'next/image';

/**
 * Clickable Aetheris AI brand used as the app's home link.
 */
export default function HeaderBrand({
  size = 38
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
        src="/aetheris-portal.png"
        alt=""
        width={size}
        height={size}
        priority
        className="shrink-0 rounded-lg"
      />
      <span className="ml-2.5 leading-tight">
        <span className="block whitespace-nowrap text-[15px] font-semibold tracking-tight text-white">
          Aetheris AI
        </span>
        <span className="block whitespace-nowrap text-[10px] font-medium tracking-wide text-cyan-200/80">
          AI WORKSPACE
        </span>
      </span>
    </Link>
  );
}
