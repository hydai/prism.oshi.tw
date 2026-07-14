import { ProgressBar } from 'prism-oshi-tw';

const noop = () => {};

// The bar's track uses the app's translucent-white surface token, which is
// invisible on the capture's flat-white card. Stage each on the app's page
// gradient (the surface these players actually sit on) so both the muted track
// and the pink→blue gradient fill read. Inner width:360 sizes the seek bar.
const panel = {
  display: 'inline-block',
  padding: 20,
  borderRadius: 16,
  background:
    'linear-gradient(135deg, var(--bg-page-start), var(--bg-page-mid), var(--bg-page-end))',
  border: '1px solid var(--border-glass)',
} as const;

export const Empty = () => (
  <div style={panel}>
    <div style={{ width: 360 }}>
      <ProgressBar progress={0} onSeek={noop} />
    </div>
  </div>
);

export const Partial = () => (
  <div style={panel}>
    <div style={{ width: 360 }}>
      <ProgressBar progress={45} onSeek={noop} />
    </div>
  </div>
);

export const Full = () => (
  <div style={panel}>
    <div style={{ width: 360 }}>
      <ProgressBar progress={100} onSeek={noop} />
    </div>
  </div>
);

export const Tall = () => (
  <div style={panel}>
    <div style={{ width: 360 }}>
      <ProgressBar progress={62} onSeek={noop} height={12} />
    </div>
  </div>
);

export const WithTimestamps = () => (
  <div style={panel}>
    <div style={{ width: 360 }}>
      <ProgressBar
        progress={45}
        onSeek={noop}
        height={6}
        showTimestamps
        currentTime="1:58"
        totalTime="4:21"
      />
    </div>
  </div>
);
