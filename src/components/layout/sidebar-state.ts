export type SidebarPreference = 'collapsed' | 'expanded' | null;

export function resolveSidebarCollapsed({
  belowDesktop,
  preference,
}: {
  belowDesktop: boolean;
  preference: SidebarPreference;
}) {
  return belowDesktop || preference === 'collapsed';
}
