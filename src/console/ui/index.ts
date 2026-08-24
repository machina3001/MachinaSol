/**
 * Machine Console design system — public surface.
 *
 * Import from here rather than reaching into individual modules, so the
 * internal file layout stays free to change.
 *
 * All components are pure presentation. They take display-ready values and
 * return `Html`. None of them fetch, format domain values, or hold state.
 * Interactive components declare intent via `data-mc-action`; the handlers live
 * in `behaviorScript()`.
 */

// Markup primitives
export {
  Html,
  EMPTY,
  attrs,
  baseAttrs,
  cx,
  esc,
  html,
  join,
  raw,
  render,
  truncateMiddle,
} from './html.js';
export type { AttrValue, BaseProps, Renderable } from './html.js';

// Icons
export { Icon, isIconName } from './icons.js';
export type { IconName, IconProps } from './icons.js';

// Layout
export {
  AppShell,
  Brand,
  Breadcrumb,
  CardGrid,
  PageHeader,
  SectionHeader,
  Sidebar,
  Split,
  Stack,
  Topbar,
  TopbarDivider,
} from './layout.js';
export type {
  AppShellProps,
  BrandProps,
  Crumb,
  NavGroup,
  NavItem,
  PageHeaderProps,
  SectionHeaderProps,
  SidebarBlock,
  SidebarProps,
  TopbarProps,
} from './layout.js';

// Data display
export {
  AddressDisplay,
  Amount,
  Chips,
  CodeBlock,
  CountBadge,
  DataCard,
  KeyValueList,
  MachineBadge,
  Meter,
  NetworkIndicator,
  Sparkline,
  StatCard,
  StatGrid,
  StatusBadge,
} from './display.js';
export type {
  AddressDisplayProps,
  DataCardProps,
  KeyValueRow,
  MachineBadgeProps,
  MeterProps,
  NetworkIndicatorProps,
  SparklineProps,
  StatCardProps,
  StatusBadgeProps,
} from './display.js';

// Controls
export { CommandButton, CopyButton, Field, SelectInput, Tabs, TextInput, Toggle, WalletButton } from './controls.js';
export type {
  ButtonVariant,
  CommandButtonProps,
  CopyButtonProps,
  FieldProps,
  SelectInputProps,
  SelectOption,
  TabItem,
  TabsProps,
  TextInputProps,
  ToggleProps,
  WalletButtonProps,
} from './controls.js';

// Overlays
export { Drawer, Menu, Modal, OverlayActions } from './overlays.js';
export type { DrawerProps, MenuItem, MenuProps, ModalProps } from './overlays.js';

// Collections
export { ActivityItem, ActivityList, DataTable, StageRail, Timeline } from './collections.js';
export type {
  ActivityItemProps,
  CellAlign,
  Column,
  DataTableProps,
  SortState,
  StageRailProps,
  TimelineEntry,
  TimelineProps,
} from './collections.js';

// Entity cards
export { JobCard, MachineCard, ResourceCard, SettlementCard } from './cards.js';
export type {
  EntityField,
  JobCardProps,
  MachineCardProps,
  ResourceCardProps,
  SettlementCardProps,
} from './cards.js';

// States
export { EmptyState, ErrorState, LoadingState, Skeleton } from './states.js';
export type { EmptyStateProps, ErrorStateProps, LoadingStateProps, SkeletonProps } from './states.js';

// Client behaviour
export { behaviorScript } from './behavior.js';

// Design tokens
export { STATUS_TONES, color, font, layout, radius, shadow, statusToneMap, toCssVars, toneFor } from '../design/tokens.js';
export type { StatusTone } from '../design/tokens.js';
export { stylesheet } from '../design/stylesheet.js';
