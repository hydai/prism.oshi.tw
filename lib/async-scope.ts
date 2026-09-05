/** A result may only affect the editing session in which its operation began. */
export function createAsyncScope() {
  let generation = 0;
  return {
    capture(): () => boolean {
      const started = generation;
      return () => generation === started;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}

export type CaptureScope = () => () => boolean;
