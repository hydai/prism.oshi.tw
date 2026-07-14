import { ThemeToggle } from 'prism-oshi-tw';

// No props — a self-contained icon button. Its surface + border are the app's
// translucent-white tokens, which disappear on the capture's flat-white card.
// Stage it on the brand accent-light gradient (the same pink→blue used by the
// player) so the round button chrome reads against it. Light theme is the
// default, so it shows the "switch to dark" moon icon.
export const Default = () => (
  <div
    style={{
      display: 'inline-flex',
      padding: 24,
      borderRadius: 16,
      background:
        'linear-gradient(135deg, var(--accent-pink-light), var(--accent-blue-light))',
    }}
  >
    <ThemeToggle />
  </div>
);
