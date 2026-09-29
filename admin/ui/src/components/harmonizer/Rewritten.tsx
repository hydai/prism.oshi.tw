/**
 * A value a Harmonizer action rewrites: the variant's own struck through, then the canonical one
 * that replaces it (none when `to` is `null`).
 */
export default function Rewritten({ from, to }: { from: string; to: string | null }) {
  return (
    <>
      <span className="text-fg-subtle line-through">{from}</span>
      {to === null ? null : <span className="ml-1.5 font-semibold text-accent-fg">{to}</span>}
    </>
  );
}
