import { createContext } from 'react';

/**
 * How the time fields of a correction review tell the page which of them hold text that does not read: a field
 * reports itself, by an id of its own, as unreadable while its text does not read, and as readable once it does again,
 * once the text is dropped, and when the field leaves the page. The page holds 套用 back while any field is
 * unreadable, so nothing is applied while the curator is still typing a time. Outside a page, a report goes nowhere.
 */
export const TimeFieldReport = createContext<(field: string, unreadable: boolean) => void>(() => undefined);
