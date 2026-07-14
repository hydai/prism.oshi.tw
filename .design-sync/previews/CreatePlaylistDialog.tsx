import { CreatePlaylistDialog } from 'prism-oshi-tw';

const noop = () => {};

// Portaled, centered modal gated by `show`. Uses usePlaylist (seeded), so the
// full "建立新播放清單" form renders over a blurred backdrop: heading + close,
// a labelled name input with placeholder, and the 建立 / 取消 action buttons.
export const Default = () => (
  <CreatePlaylistDialog show onClose={noop} onSuccess={noop} />
);
