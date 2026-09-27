import { useState } from 'react';
import { click, installDom, mount } from './helpers/dom';
import { SortHeader } from '../src/components/ui/Table';

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

type Field = 'title' | 'date';

/** Records every onSort call so the test can assert both the count and the field it fired with. */
function SortHeaderHarness({ onSort }: { onSort: (field: Field) => void }) {
  const [activeField] = useState<Field>('title');
  return (
    <table>
      <thead>
        <tr>
          <SortHeader label="Title" field="title" activeField={activeField} direction="asc" onSort={onSort} />
          <SortHeader label="Date" field="date" activeField={activeField} direction="asc" onSort={onSort} />
        </tr>
      </thead>
    </table>
  );
}

async function main(): Promise<void> {
  installDom();

  // --- clicking a column's button calls onSort with exactly that column's field, once per click ---

  const calls: Field[] = [];
  const harness = await mount(<SortHeaderHarness onSort={(field) => calls.push(field)} />);

  const buttons = Array.from(harness.container.querySelectorAll('button'));
  assert(buttons.length === 2, 'both column heads render a button');
  const [titleButton, dateButton] = buttons;
  assert(titleButton !== undefined && dateButton !== undefined, 'both buttons were found');

  await click(titleButton, "the active column's own button");
  // A fresh local for each read of calls.length — reusing one narrowed-to-a-literal expression
  // across a later mutation is the same trap tests/ui-toast.test.tsx's liveTimers.size comment
  // warns about: TypeScript keeps treating `calls.length` as the literal `1` afterwards.
  const lengthAfterFirstClick = calls.length;
  assert(lengthAfterFirstClick === 1, 'one click calls onSort exactly once');
  assert(calls[0] === 'title', 'onSort is called with the clicked column\'s field ("title")');

  await click(dateButton, "the inactive column's button");
  const lengthAfterSecondClick = calls.length;
  assert(lengthAfterSecondClick === 2, 'a second click on a different column calls onSort again, exactly once more');
  assert(calls[1] === 'date', 'onSort is called with the second column\'s field ("date"), not the first');

  await harness.unmount();

  console.log('✓ SortHeader: clicking a column\'s button calls onSort(field) exactly once, with that column\'s own field');
}

await main();
