import { Toast } from 'prism-oshi-tw';

const noop = () => {};

// Frosted pill toast pinned top-center (fixed). show=true keeps it on screen.
export const AddedToPlaylist = () => <Toast message="已加入播放清單" show onHide={noop} />;

export const RemovedFromLiked = () => <Toast message="已從喜愛移除" show onHide={noop} />;
