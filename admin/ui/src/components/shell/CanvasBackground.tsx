/**
 * The prism canvas behind the whole shell (spec §4.2): one fixed layer with the canvas paint and
 * three blurred discs, which never re-renders with the page. It paints `background: var(--canvas)`
 * rather than the `bg-canvas` image utility — the dark canvas is a plain colour, not an image.
 */
export function CanvasBackground() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden [background:var(--canvas)]"
    >
      <div className="absolute -right-[120px] -top-[140px] h-[420px] w-[420px] rounded-full bg-blob-1 blur-[70px]" />
      <div className="absolute -bottom-[120px] -left-[100px] h-[360px] w-[360px] rounded-full bg-blob-2 blur-[70px]" />
      <div className="absolute left-[40%] top-[30%] h-[300px] w-[300px] rounded-full bg-blob-3 blur-[70px]" />
    </div>
  );
}
