import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Narrows a raw URL value to a supported one; anything else falls back to the default. */
export type SearchParamValidator<T extends string> = (value: string) => value is T;

/**
 * Read one parameter out of a query string. The URL is authoritative: the
 * default is used only when the parameter is missing or unsupported, so a
 * remembered (localStorage) choice can be passed as the default without ever
 * overriding a link someone actually opened.
 */
export function readSearchParam<T extends string = string>(
  params: URLSearchParams,
  key: string,
  defaultValue: NoInfer<T>,
  validate?: SearchParamValidator<T>,
): T {
  const raw = params.get(key);
  if (raw === null) return defaultValue as T;
  if (!validate) return raw as T;
  return validate(raw) ? raw : (defaultValue as T);
}

/**
 * The query string after writing one parameter, leaving the rest untouched.
 * The default value is written as an absence, so an untouched filter never
 * shows up in the URL. `prev` is never mutated.
 */
export function nextSearchParams(
  prev: URLSearchParams,
  key: string,
  value: string,
  defaultValue: string,
): URLSearchParams {
  const next = new URLSearchParams(prev);
  if (value === defaultValue) next.delete(key);
  else next.set(key, value);
  return next;
}

/**
 * Page state that lives in the query string instead of in `useState`: a reload,
 * a shared link and the back button all restore the same view, and there is no
 * second copy of the value to keep in sync.
 *
 * Writes `replace` the current history entry — changing a filter refines the
 * page you are on, it is not a step to go back through.
 */
export function useSearchParamState<T extends string = string>(
  key: string,
  defaultValue: NoInfer<T>,
  options?: { validate?: SearchParamValidator<T> },
): [T, (value: T) => void] {
  const [params, setParams] = useSearchParams();
  const validate = options?.validate;

  const setValue = useCallback(
    (value: T) => {
      setParams((prev) => nextSearchParams(prev, key, value, defaultValue), { replace: true });
    },
    [defaultValue, key, setParams],
  );

  return [readSearchParam<T>(params, key, defaultValue, validate), setValue];
}
