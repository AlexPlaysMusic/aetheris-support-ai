import Image from 'next/image';

/**
 * Top-navbar brand section: 24px geometric 'A' mark (vector, so it stays
 * crisp on retina displays) next to the Aetheris wordmark.
 */
export default function HeaderBrand({
  size = 24,
  tagline = true
}: {
  size?: number;
  tagline?: boolean;
}) {
  return (
    <span className="flex items-center gap-2.5">
      <Image
        src="/icon.svg"
        alt="Aetheris logo"
        width={size}
        height={size}
        priority
        className="shrink-0 rounded-md"
      />
      <span className="leading-tight">
        <span className="block text-[15px] font-semibold tracking-tight text-white">
          Aetheris
        </span>
        {tagline && (
          <span className="hidden text-[11px] text-slate-400 sm:block">
            Your everyday AI chat
          </span>
        )}
      </span>
    </span>
  );
}
