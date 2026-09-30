import { EmptyState, GlassCard } from '../ui/Display';

/**
 * A Harmonizer queue's detail while its list is empty — a scan that found nothing, or every group
 * handled: the list's own words (`title`), and what to try next.
 */
export default function NoGroupsFound({ title }: { title: string }) {
  return (
    <GlassCard>
      <EmptyState icon="search" title={title} body="Try Fuzzy mode, or a lower threshold, to catch looser matches." />
    </GlassCard>
  );
}
