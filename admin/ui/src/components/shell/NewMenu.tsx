import { useNavigate } from 'react-router-dom';
import type { AuthUser } from '../../../../shared/types';
import { getNewMenuItems } from '../../lib/navigation';
import { IconButton } from '../ui/Button';
import { Menu, Popover, type MenuItem } from '../ui/Popover';

/**
 * "+ New": the routes the manifest offers for creating something, as a menu; choosing one opens
 * it and calls `onNavigate` (the drawer closes on it). The panel hangs from the sidebar's brand
 * row (`anchor="container"`), not from this small button at the row's far end, and the button's
 * tooltip opens downwards — the row sits at the top of the viewport.
 */
export function NewMenu({ user, onNavigate }: { user: AuthUser; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const items: MenuItem[] = getNewMenuItems(user).map((item) => ({
    label: item.label,
    icon: item.icon,
    description: item.description,
    onSelect: () => {
      navigate(item.to);
      onNavigate?.();
    },
  }));

  return (
    <Popover
      kind="menu"
      label="New"
      anchor="container"
      trigger={({ triggerProps }) => (
        <IconButton
          {...triggerProps}
          label="New"
          icon="plus"
          size="sm"
          tooltipSide="bottom"
          className="border border-field-line bg-field"
        />
      )}
    >
      {(close) => <Menu items={items} onDone={close} />}
    </Popover>
  );
}
