import { useEffect, useState } from 'react';
import { createAsyncScope } from '../../../../lib/async-scope';

/** Explicit selection changes and unmounts invalidate outstanding operations. */
export function useAsyncScope() {
  const [scope] = useState(createAsyncScope);
  useEffect(() => () => scope.invalidate(), [scope]);
  return scope;
}
