import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type Dispatch,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import type {
  AuthUser,
  BulkFetchSubscribersResponse,
  NovaStatus,
  NovaSubmission,
  NovaSubmissionUpdateBody,
} from '../../../shared/types';
import { sanitizeNovaUrl } from '../../../shared/nova-url-safety';
import { api } from '../api/client';
import { useInboxCounts } from '../components/shell/InboxCounts';
import { StatusFilterBar } from '../components/StatusFilterBar';
import { Avatar } from '../components/ui/Avatar';
import { Button, IconButton } from '../components/ui/Button';
import { useConfirm } from '../components/ui/confirm';
import { DetailField, SectionLabel } from '../components/ui/DetailField';
import { EmptyState, GlassCard, Skeleton } from '../components/ui/Display';
import { Field } from '../components/ui/Field';
import { fieldDescription, fieldErrorId } from '../components/ui/field-core';
import { Checkbox, SearchInput, Textarea, TextInput } from '../components/ui/Fields';
import { HorizontalScroll } from '../components/ui/HorizontalScroll';
import { Icon, type IconName } from '../components/ui/Icon';
import { MICRO_LABEL } from '../components/ui/micro-label';
import { Note } from '../components/ui/Note';
import { PageHeader } from '../components/ui/PageHeader';
import { Pill, StatusPill } from '../components/ui/Pill';
import { statusTone, TONE_BOX_CLASS } from '../components/ui/pill-core';
import { StoredTime } from '../components/ui/StoredTime';
import { TextField } from '../components/ui/TextField';
import { useToast } from '../components/ui/toast';
import { useRowDrafts, type RowDrafts } from '../hooks/useRowDrafts';
import { useSearchParamState } from '../hooks/useSearchParamState';
import { errorMessage, useApiResource } from '../lib/apiResource';
import { finiteInputNumber } from '../lib/numeric-input';
import { NO_RECENT_ACTIONS, visibleSubmissions } from '../lib/review-lists';
import { countByStatus, removeById, replaceById } from '../lib/status-totals';
import { NOVA_STATUS_FILTERS } from './nova-status-filters';
import {
  createSubmissionRowState,
  EDITABLE_FIELDS,
  parseThemeJson,
  submissionRowReducer,
  THEME_KEYS,
} from './nova-submission-row-state';
import type {
  SubmissionRowAction,
  SubmissionRowState,
} from './nova-submission-row-state';

const ROW_GRID = 'grid-cols-[40px_minmax(0,1fr)_minmax(0,1fr)_110px_120px_120px_128px_28px]';

/** The eight columns of a row. The avatar, the actions and the chevron have no visible head, only a name for assistive technology. */
const ROW_COLUMNS: ReadonlyArray<{ key: string; label: string; visible: boolean }> = [
  { key: 'avatar', label: 'Avatar', visible: false },
  { key: 'vtuber', label: 'VTuber', visible: true },
  { key: 'channel', label: 'Channel', visible: true },
  { key: 'subscribers', label: 'Subscribers', visible: true },
  { key: 'status', label: 'Status', visible: true },
  { key: 'submitted', label: 'Submitted', visible: true },
  { key: 'actions', label: 'Actions', visible: false },
  { key: 'toggle', label: 'Details', visible: false },
];

const STATUS_FILTER_LABEL_ID = 'nova-status-filter-label';

/**
 * An open row's detail is as wide as the scroller shows and pinned to its left edge. The table is 880 px
 * wide at the least, so where the scroller is narrower (a phone, and 1024 to 1190 px beside the sidebar) a
 * detail as wide as the table would run past the visible edge, to be read by scrolling the summary rows
 * sideways with it. Where the scroller is as wide as the table the two are the same width.
 */
const DETAILS_PINNED = 'sticky left-0 w-[100cqw]';

/** What a submission's request is out for: the status it is heading for, or its deletion. */
type SubmissionAction = NovaStatus | 'delete';

/** The submissions with a request out, each with what it is out for. */
const NO_ACTIONS: ReadonlyMap<string, SubmissionAction> = new Map();

const STATUS_TOASTS: Record<NovaStatus, string> = {
  approved: 'Submission approved',
  rejected: 'Submission rejected',
  pending: 'Submission reverted to pending',
};

/** One action a curator can take on a submission: how both its quick icon button and its review-card button read. */
interface ActionSpec {
  action: SubmissionAction;
  label: string;
  icon: IconName;
  tone: 'default' | 'ok' | 'danger';
}

/** The row's actions, in order. A control keeps its place across a review (Delete) or is replaced by another (Approve by Revert). */
const PENDING_ACTIONS: readonly ActionSpec[] = [
  { action: 'approved', label: 'Approve', icon: 'check', tone: 'ok' },
  { action: 'rejected', label: 'Reject', icon: 'x', tone: 'default' },
  { action: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
];
const REVIEWED_ACTIONS: readonly ActionSpec[] = [
  { action: 'pending', label: 'Revert to Pending', icon: 'undo', tone: 'default' },
  { action: 'delete', label: 'Delete', icon: 'trash', tone: 'danger' },
];

/** The status filter values this inbox understands — anything else is not a filter. */
function isNovaStatusFilter(value: string): value is '' | NovaStatus {
  return NOVA_STATUS_FILTERS.some((option) => option.value === value);
}

function isCanonicalUtcTimestamp(value: string | null): value is string {
  if (value === null || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

/** The submission as a row names it for assistive technology, a toast and a confirm: its display name, or its slug when it has none. */
function submissionLabel(sub: NovaSubmission): string {
  return sub.display_name || sub.slug;
}

/** The header's count: how many submissions there are, whatever the filters keep. */
function countText(total: number): string {
  return `${total} ${total === 1 ? 'submission' : 'submissions'}`;
}

/** Every row's name button on show, in the order the page shows them: the control that opens the row. */
function nameButtonsIn(root: HTMLElement | null): HTMLElement[] {
  return root ? [...root.querySelectorAll<HTMLElement>('button[aria-controls^="nova-submission-details-"]')] : [];
}

function nameButtonOf(root: HTMLElement | null, id: string): HTMLElement | null {
  return nameButtonsIn(root).find((button) => button.getAttribute('aria-controls') === `nova-submission-details-${id}`) ?? null;
}

/** The name button of the row after the one for `id`, or null when it is the last. */
function nextNameButton(root: HTMLElement | null, id: string): HTMLElement | null {
  const names = nameButtonsIn(root);
  const index = names.findIndex((button) => button.getAttribute('aria-controls') === `nova-submission-details-${id}`);
  return index === -1 ? null : (names[index + 1] ?? null);
}

/** The chip of the toolbar's status group that is in effect: where a delete that leaves no row to go to hands the focus. */
function statusChipInEffect(toolbar: HTMLElement | null): HTMLElement | null {
  return toolbar?.querySelector<HTMLElement>(`[aria-labelledby="${STATUS_FILTER_LABEL_ID}"] [aria-pressed="true"]`) ?? null;
}

/** Where the focus goes once a landed request's answer is on screen, if nothing else has it by then. */
type Handoff = { kind: 'row'; id: string } | { kind: 'next'; next: HTMLElement | null };

/**
 * The Nova inbox (spec §8.9): the VTuber submissions fans send from the public Nova form, as one table with
 * their status as chips and a search, and, for a curator, a quick approve, reject or delete on each row, a
 * review card and an editor in its detail, and a bulk refresh of every channel's subscriber count. One
 * unfiltered load feeds the rows and the header's counts; the status and the search (both in the URL) only
 * choose which rows are shown. A submission just reviewed stays in the list until a filter, a search or a
 * reload asks the question again, so it does not vanish from the Pending list under the cursor.
 *
 * Every request says how it went in a toast, and the control that sent it is busy meanwhile (and keeps the
 * focus; the row's other actions are unavailable, and other rows are untouched, so two can be out at once).
 * What a request that has landed did to the controls decides where the focus goes. A review replaces the
 * row's action controls (Approve by Revert), a delete removes the row: where the control that held the focus
 * is gone, the focus goes to the row's name button, or after a delete to the next row's name button, or to
 * the status chip in effect when there is no next row. It moves from nowhere (<body>), never from a control
 * the user has moved on to: another row's, a chip, a control the answer leaves in place.
 */
export default function NovaSubmissions({ user }: { user: AuthUser }) {
  const toast = useToast();
  const confirm = useConfirm();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const handoff = useRef<Handoff | null>(null);
  const [statusFilter, setStatusFilter] = useSearchParamState<'' | NovaStatus>(
    'status',
    'pending',
    { validate: isNovaStatusFilter },
  );
  // The typed term only narrows the table once the search form is submitted.
  const [appliedSearch, setAppliedSearch] = useSearchParamState('search', '');
  const [search, setSearch] = useState(appliedSearch);
  // The box follows the URL's term: one changed under the open page (Back, Forward, a link) puts its term in the box,
  // as the rows follow it, so the next Search does not write a stale term over it. Adjusted while rendering, not in
  // an effect; a status chip leaves the term, and so what is typed, alone.
  const [seededFrom, setSeededFrom] = useState(appliedSearch);
  if (seededFrom !== appliedSearch) {
    setSeededFrom(appliedSearch);
    setSearch(appliedSearch);
  }
  const [justActed, setJustActed] = useState<ReadonlySet<string>>(NO_RECENT_ACTIONS);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState(NO_ACTIONS);
  const [fetchingAll, setFetchingAll] = useState(false);
  const [fetchAllResult, setFetchAllResult] = useState<BulkFetchSubscribersResponse | null>(null);
  // Rejection notes outlive their rows, which unmount on a filter change or a reload.
  const rejectNotes = useRowDrafts();
  // When the page opened: the times only need it to leave out the current year.
  const [today] = useState(() => new Date());

  // One unfiltered load feeds both the table and the header's counts; status and
  // search narrow it here rather than costing a second request per chip click or
  // search submit.
  const list = useApiResource(async () => (await api.listNovaSubmissions()).data, []);
  // The sidebar's pending badge loads this list separately: every change here reloads it too.
  const { refresh: refreshInboxCounts } = useInboxCounts();
  // Stable reference while loading, so the filter memo doesn't recompute every render.
  const allSubmissions = useMemo(() => list.data ?? [], [list.data]);
  const submissions = useMemo(
    () => visibleSubmissions(allSubmissions, { status: statusFilter, search: appliedSearch, justActed }),
    [allSubmissions, statusFilter, appliedSearch, justActed],
  );

  // Runs after every commit: a handler cannot know which commit its state change will land in, and a flag
  // nobody has set costs nothing to read. Whoever holds the focus then is the user's, unless it is nobody:
  // the control that sent the request has just left the page with its row or been replaced by another.
  useLayoutEffect(() => {
    const pending = handoff.current;
    if (pending === null) return;
    handoff.current = null;
    const held = document.activeElement;
    if (held !== null && held !== document.body) return;
    const target =
      pending.kind === 'row'
        ? nameButtonOf(listRef.current, pending.id)
        : pending.next?.isConnected
          ? pending.next
          : statusChipInEffect(toolbarRef.current);
    target?.focus();
  });

  // A new question — another filter, another search, a fresh load — drops the
  // rows that were only being held over from the last action.
  const changeStatusFilter = (status: '' | NovaStatus) => {
    setStatusFilter(status);
    setJustActed(NO_RECENT_ACTIONS);
  };
  const applySearch = () => {
    setAppliedSearch(search);
    setJustActed(NO_RECENT_ACTIONS);
  };
  const reload = () => {
    setJustActed(NO_RECENT_ACTIONS);
    list.reload();
    refreshInboxCounts('nova');
  };
  const keepVisible = (id: string) => setJustActed((prev) => new Set(prev).add(id));

  /** Records what a submission's request is out for, or (null) that it is done. Kept here, not in the row, which can unmount meanwhile. */
  const markActing = (id: string, action: SubmissionAction | null) =>
    setActing((current) => {
      const next = new Map(current);
      if (action === null) next.delete(id);
      else next.set(id, action);
      return next;
    });

  /** Resolves true once the row may clear the note it just submitted. */
  const handleAction = async (id: string, status: NovaStatus, rejectNote: string): Promise<boolean> => {
    markActing(id, status);
    try {
      const updated = await api.updateNovaStatus(id, {
        status,
        reviewer_note: status === 'rejected' ? rejectNote : undefined,
      });
      // Before the state changes that will show it: the effect above reads the flag in the commit they land in.
      handoff.current = { kind: 'row', id };
      list.mutate((rows) => replaceById(rows, updated));
      refreshInboxCounts('nova');
      keepVisible(id);
      rejectNotes.clear(id);
      toast.success(STATUS_TOASTS[status], submissionLabel(updated));
      return true;
    } catch (err) {
      toast.error(errorMessage(err, 'Action failed'));
      return false;
    } finally {
      markActing(id, null);
    }
  };

  const handleDelete = async (sub: NovaSubmission) => {
    const confirmed = await confirm({
      title: 'Delete this submission?',
      body: `Permanently delete submission "${sub.id}" (${submissionLabel(sub)}). This cannot be undone.`,
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!confirmed) return;
    markActing(sub.id, 'delete');
    try {
      await api.deleteNovaSubmission(sub.id);
      // The next row is read while this one is still on screen: its button is the same element after the commit.
      handoff.current = { kind: 'next', next: nextNameButton(listRef.current, sub.id) };
      list.mutate((rows) => removeById(rows, sub.id));
      refreshInboxCounts('nova');
      rejectNotes.clear(sub.id);
      toast.success('Submission deleted', submissionLabel(sub));
    } catch (err) {
      toast.error(errorMessage(err, 'Delete failed'));
    } finally {
      markActing(sub.id, null);
    }
  };

  /** A row's own request (a save, a subscriber fetch, a verification) answered with the submission as it is now. */
  const applySaved = (updated: NovaSubmission) => {
    list.mutate((rows) => replaceById(rows, updated));
  };

  const handleFetchAll = async () => {
    setFetchingAll(true);
    setFetchAllResult(null);
    try {
      const result = await api.fetchAllNovaSubscribers();
      setFetchAllResult(result);
      reload();
      toast.success(`Updated ${result.updated}, failed ${result.failed}`);
    } catch (err) {
      toast.error(errorMessage(err, 'Bulk fetch failed'));
    } finally {
      setFetchingAll(false);
    }
  };

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    // The alert leaves as soon as the load restarts, and the Retry that held the focus with it: the
    // page heading takes it, rather than <body>.
    if (document.activeElement === event.currentTarget) headingRef.current?.focus();
    list.reload();
  };

  const isCurator = user.role === 'curator';
  const countOf = (status: NovaStatus) => countByStatus(allSubmissions, status);

  // The skeleton is for the first load only: a later one keeps the rows, so the control that started it keeps its place.
  const showSkeleton = list.data === null && list.loading;
  const showEmpty = list.data !== null && submissions.length === 0;

  return (
    // No blur, transform or filter on this root or its wrappers, and no overflow either: the sticky
    // header tracks <main>.
    <div className="flex flex-col">
      <PageHeader
        crumb="INBOX"
        title="Nova"
        titleRef={headingRef}
        meta={
          list.data === null ? undefined : (
            <>
              <span>{countText(allSubmissions.length)}</span>
              <Pill tone={statusTone('pending')}>{countOf('pending')} Pending</Pill>
              <Pill tone={statusTone('approved')}>{countOf('approved')} Approved</Pill>
              <Pill tone={statusTone('rejected')}>{countOf('rejected')} Rejected</Pill>
            </>
          )
        }
        actions={
          isCurator ? (
            <Button
              icon="refresh"
              busy={fetchingAll}
              aria-disabled={list.loading ? true : undefined}
              onClick={() => void handleFetchAll()}
            >
              Fetch All Channel Info
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-3 p-4 lg:px-5 lg:pb-[18px]">
        <SubmissionsToolbar
          toolbarRef={toolbarRef}
          status={statusFilter}
          onStatusChange={changeStatusFilter}
          search={search}
          onSearchChange={setSearch}
          onSearchSubmit={applySearch}
        />

        {fetchAllResult ? <BulkFetchNote result={fetchAllResult} /> : null}

        {list.error !== null ? (
          <Note
            tone="danger"
            icon="alert"
            role="alert"
            title="Couldn't load submissions."
            action={<Button size="sm" icon="refresh" onClick={handleRetry}>Retry</Button>}
          >
            {list.error}
          </Note>
        ) : null}

        {showSkeleton ? (
          <GlassCard>
            <Skeleton rows={6} label="Loading submissions…" />
          </GlassCard>
        ) : null}

        {showEmpty ? (
          <GlassCard>
            <EmptyState icon="inbox" title="No submissions found." />
          </GlassCard>
        ) : null}

        {submissions.length > 0 ? (
          <GlassCard ref={listRef} padding="sm" className="overflow-clip">
            <SubmissionsTable>
              {submissions.map((sub) => (
                <SubmissionRow
                  key={sub.id}
                  sub={sub}
                  isCurator={isCurator}
                  expanded={expandedId === sub.id}
                  acting={acting.get(sub.id)}
                  today={today}
                  onToggle={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
                  drafts={rejectNotes}
                  onAction={handleAction}
                  onDelete={handleDelete}
                  onSave={applySaved}
                />
              ))}
            </SubmissionsTable>
          </GlassCard>
        ) : null}
      </div>
    </div>
  );
}

/** The status chips behind a visible label, and the search: it narrows the table once it is submitted. */
function SubmissionsToolbar({
  toolbarRef,
  status,
  onStatusChange,
  search,
  onSearchChange,
  onSearchSubmit,
}: {
  toolbarRef: Ref<HTMLDivElement>;
  status: '' | NovaStatus;
  onStatusChange: (status: '' | NovaStatus) => void;
  search: string;
  onSearchChange: (search: string) => void;
  onSearchSubmit: () => void;
}) {
  return (
    <div ref={toolbarRef} className="flex flex-wrap items-center gap-x-6 gap-y-2">
      <StatusFilterBar
        options={NOVA_STATUS_FILTERS}
        value={status}
        onChange={onStatusChange}
        labelledBy={STATUS_FILTER_LABEL_ID}
        className="flex-wrap gap-2"
        heading={
          <span id={STATUS_FILTER_LABEL_ID} className={MICRO_LABEL}>
            Status
          </span>
        }
      />
      <form
        className="ml-auto w-64 max-sm:ml-0 max-sm:w-full"
        onSubmit={(event) => {
          event.preventDefault();
          onSearchSubmit();
        }}
      >
        <SearchInput
          value={search}
          onChange={onSearchChange}
          placeholder="Search ID, slug, channel..."
          label="Search submissions"
          className="w-full"
        />
      </form>
    </div>
  );
}

/**
 * What "Fetch All Channel Info" did: how many channels it updated and how many it could not, and which. The
 * toast says the same in the page's live region, so this is the record that stays on screen and is no live
 * region of its own (a role here would have a screen reader announce the result twice).
 */
function BulkFetchNote({ result }: { result: BulkFetchSubscribersResponse }) {
  const failed = result.failed > 0;
  return (
    <div id="nova-fetch-all-result">
      <Note
        tone={failed ? 'warn' : 'ok'}
        icon={failed ? 'alert' : 'checkCircle'}
        title={`Updated ${result.updated}, failed ${result.failed}`}
      >
        {result.results.length > 0 ? (
          <details className="mt-1">
            <summary className="cursor-pointer rounded-radius-xs font-semibold hover:underline">
              Show details ({result.results.length} streamers)
            </summary>
            <ul className="mt-1 flex flex-col gap-1">
              {result.results.map((entry) => (
                <li key={entry.id} className={entry.error ? 'font-semibold text-tone-danger-fg' : undefined}>
                  {entry.display_name}:{' '}
                  {entry.error ? entry.error : `${entry.subscriber_count}${entry.avatar_url ? ' (avatar updated)' : ''}`}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </Note>
    </div>
  );
}

/**
 * The rows' table: one `<tbody>` a row under a head row of the kit's head label. It keeps its width and
 * scrolls inside its card. The head is a grid like the rows, so its columns line up with theirs. The
 * scroller is a size container, so that an open row's detail can be as wide as what the scroller shows
 * (`cqw`) while the table is wider: see `DETAILS_PINNED`.
 */
function SubmissionsTable({ children }: { children: ReactNode }) {
  return (
    <HorizontalScroll className="overflow-x-auto [container-type:inline-size]">
      <table aria-label="VTuber submissions" className="block min-w-[880px]">
        <thead className="block">
          <tr className={`${ROW_GRID} grid items-center border-b border-line-soft px-3 py-2`}>
            {ROW_COLUMNS.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.visible ? `p-0 pl-3 text-left ${MICRO_LABEL}` : 'p-0 text-left'}
              >
                {column.visible ? column.label : <span className="sr-only">{column.label}</span>}
              </th>
            ))}
          </tr>
        </thead>
        {children}
      </table>
    </HorizontalScroll>
  );
}

interface SubmissionRowProps {
  sub: NovaSubmission;
  isCurator: boolean;
  expanded: boolean;
  /** What this submission's request is out for, if one is. */
  acting: SubmissionAction | undefined;
  /** When the page opened: the times only need it to leave out the current year. */
  today: Date;
  onToggle: () => void;
  /** The page's note store: this row seeds from it and writes back to it. */
  drafts: RowDrafts;
  /** Resolves true when the review landed, so the row may drop its note. */
  onAction: (id: string, status: NovaStatus, rejectNote: string) => Promise<boolean>;
  onDelete: (sub: NovaSubmission) => void;
  /** The submission as the worker answered a request of this row's own. */
  onSave: (updated: NovaSubmission) => void;
}

/**
 * One submission: its summary row and, while open, its detail. The reviewer note and the editor's drafts are
 * the row's (typing re-renders this submission, not the inbox), and the note is seeded from, and written
 * through to, the page's store, so it survives the row unmounting. The review's request is the page's, not
 * the row's: `acting` says what is out for this submission, and the buttons follow it however often the row
 * opens and closes. The editor's own requests (a save, a subscriber fetch, a channel verification) are the
 * row's, and each says how it went: a toast when it worked, a line beside its buttons when it did not.
 *
 * When the control that held the focus goes, the focus moves to the one that takes its place, never to
 * <body>: Edit hands it to the first field, Save and Cancel hand it back to Edit. Only focus that is nowhere
 * moves, so an answer that lands after the user has gone elsewhere takes nothing.
 */
export function SubmissionRow({
  sub,
  isCurator,
  expanded,
  acting,
  today,
  onToggle,
  drafts,
  onAction,
  onDelete,
  onSave,
}: SubmissionRowProps) {
  const toast = useToast();
  const [state, dispatch] = useReducer(
    submissionRowReducer,
    sub,
    (submission) => createSubmissionRowState(submission, drafts.read(submission.id)),
  );
  const { editing, rejectNote, draft, orderDraft, saving } = state;
  const editRef = useRef<HTMLButtonElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const focusNext = useRef<'edit' | 'field' | null>(null);
  const detailsId = `nova-submission-details-${sub.id}`;
  const label = submissionLabel(sub);

  // Whatever changes the submission this row holds (a fetch, a verification, a review, a reload) is merged into
  // the drafts: what the curator has changed in the editor stays, and the rest follows the worker.
  useEffect(() => {
    dispatch({ type: 'submissionChanged', submission: sub });
  }, [sub]);

  // After the commit that swapped the toolbar's buttons: the one that held the focus has left, so the focus
  // is nowhere, and is handed to the control that takes its place.
  useLayoutEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    const held = document.activeElement;
    if (held !== null && held !== document.body) return;
    (target === 'edit' ? editRef : firstFieldRef).current?.focus();
  });

  // One press: a review sends the status (and the note a rejection carries), a delete asks first.
  const press = async (action: SubmissionAction) => {
    if (action === 'delete') onDelete(sub);
    else if (await onAction(sub.id, action, rejectNote)) dispatch({ type: 'rejectNoteCleared' });
  };

  const startEditing = () => {
    focusNext.current = 'field';
    dispatch({ type: 'editStarted' });
  };

  const handleCancel = () => {
    focusNext.current = 'edit';
    dispatch({ type: 'editCancelled', submission: sub });
  };

  const handleSave = async () => {
    if (orderDraft === undefined) {
      dispatch({ type: 'saveValidationFailed', error: 'Display order must be a number.' });
      return;
    }

    dispatch({ type: 'saveStarted' });
    try {
      // Only send fields that actually changed
      const changes: NovaSubmissionUpdateBody = {};
      for (const { key } of EDITABLE_FIELDS) {
        if (draft[key] !== (sub[key] ?? '')) {
          changes[key] = draft[key];
        }
      }
      // Theme JSON
      const newThemeJson = JSON.stringify(state.themeDraft);
      if (newThemeJson !== (sub.theme_json || '')) {
        changes.theme_json = newThemeJson;
      }
      // Enabled
      const newEnabled = state.enabledDraft ? 1 : 0;
      if (newEnabled !== sub.enabled) {
        changes.enabled = newEnabled;
      }
      // Display order
      if (orderDraft !== (sub.display_order ?? 0)) {
        changes.display_order = orderDraft;
      }
      if (Object.keys(changes).length === 0) {
        focusNext.current = 'edit';
        dispatch({ type: 'saveSucceeded' });
        return;
      }
      const updated = await api.updateNovaSubmission(sub.id, changes);
      onSave(updated);
      focusNext.current = 'edit';
      dispatch({ type: 'saveSucceeded', submission: updated });
      toast.success('Submission saved', submissionLabel(updated));
    } catch (err) {
      dispatch({
        type: 'saveFailed',
        error: err instanceof Error ? err.message : 'Save failed',
      });
    } finally {
      dispatch({ type: 'saveFinished' });
    }
  };

  // The editor is a form whose submit button is Save: Enter in a field saves, and the page never navigates.
  // Not while a save is out: the busy Save ignores its click, and so must a submit that comes some other way.
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!saving) void handleSave();
  };

  const handleFetchSubscribers = async () => {
    dispatch({ type: 'subscribersFetchStarted' });
    try {
      const updated = await api.fetchNovaSubscribers(sub.id);
      // Into the drafts through the merge, like any changed submission: a field typed meanwhile keeps the typing.
      onSave(updated);
      toast.success('Channel info updated', submissionLabel(updated));
    } catch (err) {
      dispatch({
        type: 'subscribersFetchFailed',
        error: err instanceof Error ? err.message : 'Failed to fetch subscribers',
      });
    } finally {
      dispatch({ type: 'subscribersFetchFinished' });
    }
  };

  const handleVerifyChannel = async () => {
    dispatch({ type: 'verificationStarted' });
    try {
      const updated = await api.verifyNovaYoutubeChannel(sub.id);
      onSave(updated);
      toast.success('Channel verified', submissionLabel(updated));
    } catch (err) {
      dispatch({
        type: 'verificationFailed',
        error: err instanceof Error ? err.message : 'Channel verification failed',
      });
    } finally {
      dispatch({ type: 'verificationFinished' });
    }
  };

  const channelVerified = Boolean(
    sub.youtube_channel_id
    && sub.youtube_channel_verified_id === sub.youtube_channel_id
    && isCanonicalUtcTimestamp(sub.youtube_channel_verified_at),
  );

  const youtubeChannelUrl = sanitizeNovaUrl(sub.youtube_channel_url, 'youtube');
  const avatarUrl = sanitizeNovaUrl(sub.avatar_url, 'image');
  const showReviewCard = isCurator && !editing;

  return (
    <tbody className={`mt-0.5 block rounded-radius-lg ${expanded ? 'bg-selected' : ''}`}>
      <SubmissionSummaryRow
        sub={sub}
        label={label}
        avatarUrl={avatarUrl}
        youtubeChannelUrl={youtubeChannelUrl}
        isCurator={isCurator}
        expanded={expanded}
        acting={acting}
        today={today}
        onToggle={onToggle}
        onPress={press}
      />
      {expanded && (
        <tr className="block">
          {/* One column below 1280 px, where a curator's review card becomes a second column beside the fields. */}
          <td
            colSpan={ROW_COLUMNS.length}
            id={detailsId}
            className={`grid grid-cols-1 gap-6 border-t border-line-soft px-3 pb-3 pt-4 ${DETAILS_PINNED}${
              showReviewCard ? ' xl:grid-cols-[minmax(0,1fr)_360px]' : ''
            }`}
          >
            <SubmissionDetails
              sub={sub}
              isCurator={isCurator}
              state={state}
              dispatch={dispatch}
              today={today}
              youtubeChannelUrl={youtubeChannelUrl}
              avatarUrl={avatarUrl}
              channelVerified={channelVerified}
              editRef={editRef}
              firstFieldRef={firstFieldRef}
              onEdit={startEditing}
              onCancel={handleCancel}
              onSubmit={handleSubmit}
              onFetchSubscribers={handleFetchSubscribers}
              onVerifyChannel={handleVerifyChannel}
            />
            {showReviewCard && (
              <SubmissionReviewCard
                sub={sub}
                acting={acting}
                rejectNote={rejectNote}
                onNoteChange={(value) => {
                  drafts.write(sub.id, value);
                  dispatch({ type: 'rejectNoteChanged', value });
                }}
                onPress={press}
              />
            )}
          </td>
        </tr>
      )}
    </tbody>
  );
}

function SubmissionSummaryRow({
  sub,
  label,
  avatarUrl,
  youtubeChannelUrl,
  isCurator,
  expanded,
  acting,
  today,
  onToggle,
  onPress,
}: {
  sub: NovaSubmission;
  label: string;
  avatarUrl: string | null;
  youtubeChannelUrl: string | null;
  isCurator: boolean;
  expanded: boolean;
  acting: SubmissionAction | undefined;
  today: Date;
  onToggle: () => void;
  onPress: (action: SubmissionAction) => void;
}) {
  return (
    // The name cell is the accessible toggle control (keyboard focus, expanded
    // state); the chevron is a mouse-only duplicate of it.
    <tr className={`${ROW_GRID} grid items-center rounded-radius-lg px-3 py-2 transition-colors hover:bg-row-hover`}>
      <td className="flex items-center p-0">
        <Avatar src={avatarUrl} alt="" size={40} />
      </td>
      <td className="flex min-w-0 p-0">
        <button
          type="button"
          tabIndex={0}
          aria-expanded={expanded}
          aria-controls={`nova-submission-details-${sub.id}`}
          aria-label={`${expanded ? '收合' : '展開'} ${label}`}
          onClick={onToggle}
          className="flex min-w-0 flex-col items-start gap-0.5 rounded-radius-sm pl-3 text-left focus-visible:outline-none focus-visible:shadow-focus"
        >
          <span
            className={`max-w-full truncate text-[15px] font-bold leading-tight ${
              expanded ? 'text-accent-fg' : 'text-fg'
            }`}
          >
            {sub.display_name || '—'}
          </span>
          <span className="max-w-full truncate font-mono text-[11px] text-fg-muted">{sub.slug}</span>
        </button>
      </td>
      <td className="flex min-w-0 items-center gap-1.5 p-0 pl-3 text-[13px] text-fg-muted">
        {youtubeChannelUrl ? (
          <a
            href={youtubeChannelUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex min-w-0 items-center gap-1.5 rounded-radius-xs transition-colors hover:text-accent-fg focus-visible:outline-none focus-visible:shadow-focus"
          >
            <Icon name="youtube" size={14} className="shrink-0 text-tone-danger-fg" />
            <span className="truncate">{sub.brand_name || sub.youtube_channel_url}</span>
          </a>
        ) : (
          <span className="truncate">{sub.brand_name || sub.youtube_channel_url || '—'}</span>
        )}
      </td>
      <td className={`p-0 pl-3 text-[13px] font-semibold ${sub.subscriber_count ? 'text-fg' : 'text-fg-subtle'}`}>
        {sub.subscriber_count || '—'}
      </td>
      <td className="p-0 pl-3">
        <StatusPill status={sub.status} />
      </td>
      <td className="p-0 pl-3">
        <StoredTime value={sub.submitted_at} today={today} className="font-mono text-[11px] text-fg-muted" />
      </td>
      <td className="flex items-center justify-end gap-1.5 p-0">
        {isCurator && !expanded
          ? (sub.status === 'pending' ? PENDING_ACTIONS : REVIEWED_ACTIONS).map((spec) => (
              <QuickAction key={spec.action} spec={spec} acting={acting} onPress={onPress} />
            ))
          : null}
      </td>
      <td className="flex justify-end p-0">
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={onToggle}
          className="flex justify-end text-fg-subtle transition-colors hover:text-accent-fg"
        >
          <Icon name={expanded ? 'chevronDown' : 'chevronRight'} size={20} />
        </button>
      </td>
    </tr>
  );
}

/**
 * A row's quick action: an icon button named for what it does. The one that sent the request is busy (and
 * keeps the focus); the row's others are `aria-disabled` while it is out, so none takes a press.
 */
function QuickAction({
  spec,
  acting,
  onPress,
}: {
  spec: ActionSpec;
  acting: SubmissionAction | undefined;
  onPress: (action: SubmissionAction) => void;
}) {
  return (
    <IconButton
      label={spec.label}
      icon={spec.icon}
      tone={spec.tone}
      size="sm"
      busy={acting === spec.action}
      aria-disabled={acting !== undefined && acting !== spec.action ? true : undefined}
      onClick={() => onPress(spec.action)}
    />
  );
}

/**
 * The curator's side of an expanded row: the rejection note (of a submission still pending) and what to do
 * with it. The button that sent a request is busy and keeps the focus; the others are unavailable beside it.
 */
function SubmissionReviewCard({
  sub,
  acting,
  rejectNote,
  onNoteChange,
  onPress,
}: {
  sub: NovaSubmission;
  acting: SubmissionAction | undefined;
  rejectNote: string;
  onNoteChange: (value: string) => void;
  onPress: (action: SubmissionAction) => void;
}) {
  const pending = sub.status === 'pending';
  const noteId = `nova-reject-note-${sub.id}`;
  return (
    <GlassCard className="flex flex-col gap-2.5 self-start">
      {pending ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={noteId} className={MICRO_LABEL}>
            Reviewer Note (optional, shown on reject)
          </label>
          <Textarea
            id={noteId}
            value={rejectNote}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Reason for rejection..."
            rows={3}
            className="block resize-y"
          />
        </div>
      ) : (
        <SectionLabel>Review</SectionLabel>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {(pending ? PENDING_ACTIONS : REVIEWED_ACTIONS).map((spec) => (
          <Button
            key={spec.action}
            variant={spec.action === 'approved' ? 'primary' : spec.action === 'delete' ? 'ghost' : 'secondary'}
            size="sm"
            icon={spec.icon}
            busy={acting === spec.action}
            aria-disabled={acting !== undefined && acting !== spec.action ? true : undefined}
            className={spec.action === 'delete' ? 'ml-auto' : undefined}
            onClick={() => onPress(spec.action)}
          >
            {spec.label}
          </Button>
        ))}
      </div>
    </GlassCard>
  );
}

/**
 * The fields column of an open row: who the submission is, a curator's Edit and Verify channel (or Save and
 * Cancel while editing), and then either the editor or the read-only view. The editor is a form with the
 * browser's own validation off, so its inline errors are the only ones; Save is its submit button.
 */
function SubmissionDetails({
  sub,
  isCurator,
  state,
  dispatch,
  today,
  youtubeChannelUrl,
  avatarUrl,
  channelVerified,
  editRef,
  firstFieldRef,
  onEdit,
  onCancel,
  onSubmit,
  onFetchSubscribers,
  onVerifyChannel,
}: {
  sub: NovaSubmission;
  isCurator: boolean;
  state: SubmissionRowState;
  dispatch: Dispatch<SubmissionRowAction>;
  today: Date;
  youtubeChannelUrl: string | null;
  avatarUrl: string | null;
  channelVerified: boolean;
  editRef: Ref<HTMLButtonElement>;
  firstFieldRef: Ref<HTMLInputElement>;
  onEdit: () => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onFetchSubscribers: () => void;
  onVerifyChannel: () => void;
}) {
  const { editing } = state;
  return (
    <form noValidate onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        {!editing && <SubmissionAvatar sub={sub} safeUrl={avatarUrl} />}
        <div className="min-w-0 flex-1 basis-40">
          <p className="break-words text-xl font-bold leading-tight text-fg">{sub.display_name}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-[13px] text-fg-muted">
            <span>{sub.brand_name || sub.slug}</span>
            {sub.group && (
              <>
                <span className="text-fg-subtle">·</span>
                <span>{sub.group}</span>
              </>
            )}
            <Pill tone={channelVerified ? 'ok' : 'neutral'} className="gap-1">
              <Icon name="shield" size={11} />
              {channelVerified ? 'Verified' : 'Not verified'}
            </Pill>
          </p>
        </div>
        {isCurator && (
          <SubmissionToolbar
            state={state}
            hasChannelId={Boolean(sub.youtube_channel_id)}
            channelVerified={channelVerified}
            editRef={editRef}
            onEdit={onEdit}
            onCancel={onCancel}
            onVerifyChannel={onVerifyChannel}
          />
        )}
      </div>

      {editing ? (
        <SubmissionEditor
          sub={sub}
          state={state}
          dispatch={dispatch}
          firstFieldRef={firstFieldRef}
          onFetchSubscribers={onFetchSubscribers}
        />
      ) : (
        <SubmissionView
          sub={sub}
          today={today}
          youtubeChannelUrl={youtubeChannelUrl}
          channelVerified={channelVerified}
        />
      )}
    </form>
  );
}

/** What a failed request of the row's own says, beside the buttons that sent it. */
const INLINE_ERROR = 'text-meta font-semibold text-tone-danger-fg';

function SubmissionToolbar({
  state,
  hasChannelId,
  channelVerified,
  editRef,
  onEdit,
  onCancel,
  onVerifyChannel,
}: {
  state: SubmissionRowState;
  hasChannelId: boolean;
  channelVerified: boolean;
  editRef: Ref<HTMLButtonElement>;
  onEdit: () => void;
  onCancel: () => void;
  onVerifyChannel: () => void;
}) {
  const { editing, saving, saveError, orderDraft, verifyingChannel, verificationError } = state;

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {/* Keyed: the button that is pressed is another element than the one that takes its place. */}
      {!editing ? (
        <>
          <Button key="edit" ref={editRef} size="sm" icon="pencil" onClick={onEdit}>
            Edit
          </Button>
          <Button
            key="verify"
            size="sm"
            icon="shield"
            busy={verifyingChannel}
            disabled={!hasChannelId}
            aria-disabled={channelVerified ? true : undefined}
            onClick={onVerifyChannel}
          >
            {channelVerified ? 'Channel verified' : 'Verify channel'}
          </Button>
        </>
      ) : (
        <>
          <Button
            key="save"
            type="submit"
            variant="primary"
            size="sm"
            icon="check"
            busy={saving}
            disabled={orderDraft === undefined}
          >
            Save
          </Button>
          <Button key="cancel" size="sm" aria-disabled={saving ? true : undefined} onClick={onCancel}>
            Cancel
          </Button>
        </>
      )}
      {saveError && (
        <span role="alert" className={INLINE_ERROR}>
          {saveError}
        </span>
      )}
      {verificationError && (
        <span role="alert" className={INLINE_ERROR}>
          {verificationError}
        </span>
      )}
    </div>
  );
}

function SubmissionAvatar({
  sub,
  safeUrl,
}: {
  sub: NovaSubmission;
  safeUrl: string | null;
}) {
  if (!sub.avatar_url) return <Avatar src={null} alt="" size={64} />;

  if (safeUrl) return <Avatar src={safeUrl} alt={sub.display_name} size={64} />;

  return (
    <div className="flex items-center gap-3">
      <Avatar src={null} alt="" size={64} />
      <p className="max-w-[240px] break-all text-xs text-fg-subtle">Invalid avatar URL: {sub.avatar_url}</p>
    </div>
  );
}

function SubmissionEditor({
  sub,
  state,
  dispatch,
  firstFieldRef,
  onFetchSubscribers,
}: {
  sub: NovaSubmission;
  state: SubmissionRowState;
  dispatch: Dispatch<SubmissionRowAction>;
  firstFieldRef: Ref<HTMLInputElement>;
  onFetchSubscribers: () => void;
}) {
  const { draft, themeDraft, enabledDraft, orderDraft, fetchingSubscribers, fetchSubscribersError } = state;
  const enabledId = `nova-enabled-${sub.id}`;
  const orderId = `nova-display-order-${sub.id}`;
  const orderHint = orderDraft === undefined ? undefined : 'Lower = first';
  const orderError = orderDraft === undefined ? 'Enter a number' : null;

  return (
    <>
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {EDITABLE_FIELDS.map(({ key, label, multiline }) => {
          const id = `nova-${sub.id}-${key}`;
          const change = (value: string) => dispatch({ type: 'draftFieldChanged', key, value });
          if (multiline) {
            return (
              <div key={key} className="sm:col-span-2">
                <Field id={id} label={label}>
                  <Textarea
                    id={id}
                    value={draft[key]}
                    onChange={(event) => change(event.target.value)}
                    rows={3}
                    className="block resize-y"
                  />
                </Field>
              </div>
            );
          }
          if (key === 'subscriber_count') {
            return (
              <Field key={key} id={id} label={label}>
                <div className="flex gap-2">
                  <TextInput
                    id={id}
                    value={draft[key]}
                    onChange={(event) => change(event.target.value)}
                    aria-describedby={fetchSubscribersError ? fieldErrorId(id) : undefined}
                  />
                  <Button
                    size="sm"
                    icon="refresh"
                    className="shrink-0"
                    busy={fetchingSubscribers}
                    disabled={!sub.youtube_channel_id}
                    title={!sub.youtube_channel_id ? 'Set YouTube Channel ID first' : 'Fetch subscriber count & avatar from YouTube'}
                    onClick={onFetchSubscribers}
                  >
                    Fetch
                  </Button>
                </div>
                {fetchSubscribersError && (
                  <p id={fieldErrorId(id)} role="alert" className={INLINE_ERROR}>
                    {fetchSubscribersError}
                  </p>
                )}
              </Field>
            );
          }
          return (
            <TextField
              key={key}
              id={id}
              ref={key === 'display_name' ? firstFieldRef : undefined}
              label={label}
              value={draft[key]}
              onChange={change}
            />
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="flex h-9 items-center gap-3">
          <Checkbox
            id={enabledId}
            checked={enabledDraft}
            onChange={(enabled) => dispatch({ type: 'enabledChanged', enabled })}
            label="Enabled"
            visibleLabel
            aria-describedby={`${enabledId}-state`}
          />
          <span id={`${enabledId}-state`} className="text-meta text-fg-muted">
            {enabledDraft ? 'Visible on site' : 'Hidden from site'}
          </span>
        </div>
        <div className="w-32">
          <Field id={orderId} label="Order" required hint={orderHint} error={orderError}>
            <TextInput
              id={orderId}
              type="number"
              value={orderDraft ?? ''}
              onChange={(event) => dispatch({
                type: 'orderChanged',
                order: finiteInputNumber(event.currentTarget.valueAsNumber),
              })}
              aria-required="true"
              aria-invalid={orderError ? true : undefined}
              aria-describedby={fieldDescription(orderId, { hint: orderHint, error: orderError })}
            />
          </Field>
        </div>
      </div>

      <div>
        <SectionLabel>Theme Colors</SectionLabel>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {THEME_KEYS.map((key) => (
            <div key={key} className="flex items-center gap-2">
              <input
                type="color"
                aria-label={`${key} theme color`}
                value={themeDraft[key]}
                onChange={(event) => dispatch({
                  type: 'themeColorChanged',
                  key,
                  value: event.target.value.toUpperCase(),
                })}
                className="h-7 w-7 cursor-pointer rounded-radius-xs border border-field-line bg-field p-0"
              />
              <div className="min-w-0 flex-1">
                <span className="block truncate text-xs text-fg-muted">{key}</span>
                <span className="block font-mono text-[10px] text-fg-subtle">{themeDraft[key]}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/** A social link as a pill: an info one that opens it, a warn one for a link that is not safe to open, a struck one for none. */
function SocialLinks({ sub }: { sub: NovaSubmission }) {
  const links = [
    { label: 'YouTube', url: sub.link_youtube, safeUrl: sanitizeNovaUrl(sub.link_youtube, 'youtube') },
    { label: 'Twitter', url: sub.link_twitter, safeUrl: sanitizeNovaUrl(sub.link_twitter, 'twitter') },
    { label: 'Facebook', url: sub.link_facebook, safeUrl: sanitizeNovaUrl(sub.link_facebook, 'facebook') },
    { label: 'Instagram', url: sub.link_instagram, safeUrl: sanitizeNovaUrl(sub.link_instagram, 'instagram') },
    { label: 'Twitch', url: sub.link_twitch, safeUrl: sanitizeNovaUrl(sub.link_twitch, 'twitch') },
  ];
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {links.map((link) => (
        <span key={link.label} title={link.safeUrl === null && link.url ? link.url : undefined}>
          {link.safeUrl ? (
            <a
              href={link.safeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-radius-pill border px-2 py-0.5 text-2xs font-bold hover:underline ${TONE_BOX_CLASS.info}`}
            >
              <Icon name="external" size={11} />
              {link.label}
            </a>
          ) : link.url ? (
            <Pill tone="warn">Invalid {link.label}</Pill>
          ) : (
            <Pill tone="neutral" className="line-through">
              {link.label}
            </Pill>
          )}
        </span>
      ))}
    </div>
  );
}

function SubmissionView({
  sub,
  today,
  youtubeChannelUrl,
  channelVerified,
}: {
  sub: NovaSubmission;
  today: Date;
  youtubeChannelUrl: string | null;
  channelVerified: boolean;
}) {
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        <DetailField label="Brand Name">{sub.brand_name || '—'}</DetailField>
        <DetailField label="Group">{sub.group || '—'}</DetailField>
        <DetailField label="Enabled">{sub.enabled === 1 ? 'Yes' : 'No'}</DetailField>
        <DetailField label="Display Order">{sub.display_order ?? 0}</DetailField>
        <DetailField label="YouTube Channel URL" className="sm:col-span-2">
          {youtubeChannelUrl ? (
            <a
              href={youtubeChannelUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="break-all text-accent-fg hover:underline"
            >
              {sub.youtube_channel_url}
            </a>
          ) : (
            <span className="break-all">{sub.youtube_channel_url || '—'}</span>
          )}
        </DetailField>
        <DetailField label="YouTube Channel ID">
          <span className="font-mono text-xs">{sub.youtube_channel_id || '—'}</span>
        </DetailField>
        <DetailField label="Channel verification">
          {channelVerified && sub.youtube_channel_verified_at ? (
            <>
              Verified <StoredTime value={sub.youtube_channel_verified_at} today={today} />
            </>
          ) : (
            'Not verified'
          )}
        </DetailField>
        <DetailField label="Subscriber Count">{sub.subscriber_count || '—'}</DetailField>
        <DetailField label="Description" className="sm:col-span-3">
          <span className="whitespace-pre-line">{sub.description || '—'}</span>
        </DetailField>
      </dl>

      <div>
        <SectionLabel>Social Links</SectionLabel>
        <SocialLinks sub={sub} />
      </div>

      {sub.theme_json && (
        <div>
          <SectionLabel>Theme Colors</SectionLabel>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {Object.entries(parseThemeJson(sub.theme_json)).map(([key, color]) => (
              <div
                key={key}
                title={`${key}: ${color}`}
                className="h-5 w-5 rounded-radius-circle border border-line-soft"
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      )}

      <dl className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-3">
        <DetailField label="Reviewed At">
          {sub.reviewed_at ? <StoredTime value={sub.reviewed_at} today={today} /> : '—'}
        </DetailField>
        <DetailField label="Reviewer Note" className="sm:col-span-2">
          <span className="whitespace-pre-line">{sub.reviewer_note || '—'}</span>
        </DetailField>
      </dl>
    </>
  );
}
