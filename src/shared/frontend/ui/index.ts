export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export { Card, type CardProps } from "./card";
export { Pill, StatusPill, type PillProps, type PillTone } from "./pill";
export { Chip, type ChipProps } from "./chip";
export { IconButton, type IconButtonProps } from "./icon-button";
export {
  Tooltip,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  TooltipContent,
} from "./tooltip";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuPortal,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuGroup,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  MENU_CONTENT,
  MENU_ITEM,
  MENU_ITEM_DESTRUCTIVE,
  type DropdownMenuItemProps,
  type DropdownMenuShortcutProps,
} from "./dropdown-menu";
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuPortal,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  type ContextMenuItemProps,
} from "./context-menu";
export { RelevanceBar, relevanceTier } from "./relevance-bar";
export {
  StackedCard,
  type StackedCardProps,
  type StackedCardTone,
} from "./stacked-card";
export { Textarea, type TextareaProps } from "./textarea";

/* Neutral-EDA building blocks (design D2 §3/§6/§7/§9, design D3 §5). */
export {
  PanelSectionHeader,
  type PanelSectionHeaderProps,
} from "./panel-section-header";
export {
  PropertyGrid,
  PropertyRow,
  type PropertyGridProps,
  type PropertyRowProps,
} from "./property-grid";
export {
  TableHeaderRow,
  TableRow,
  type TableHeaderRowProps,
  type TableRowProps,
} from "./data-table";
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentedOption,
} from "./segmented-control";
export { SearchField, type SearchFieldProps } from "./search-field";
export { Checkbox, type CheckboxProps } from "./checkbox";
export { StatusDot, type StatusDotProps, type StatusTone } from "./status-dot";
export {
  SeverityDiamond,
  type SeverityDiamondProps,
  type SeverityLevel,
} from "./severity-diamond";
export {
  DockTabs,
  dockTabIds,
  dockTabPanelProps,
  type DockTabsProps,
  type DockTabItem,
} from "./dock-tabs";
export {
  StatusBar,
  StatusSegment,
  type StatusBarProps,
  type StatusSegmentProps,
} from "./status-bar";
export {
  Toolbar,
  ToolbarButton,
  ToolbarSeparator,
  ToolbarSpacer,
  type ToolbarProps,
  type ToolbarButtonProps,
} from "./toolbar";
export {
  CanvasZoomCluster,
  type CanvasZoomClusterProps,
} from "./canvas-zoom-cluster";

/* Design-system foundation (UI QA wave F0a — see docs/design/design-tokens.md). */
export {
  FOCUS_RING,
  FOCUS_RING_OUTSET,
  FIELD_BASE,
  FIELD_FOCUS,
  FIELD_FOCUS_WITHIN,
  FIELD_INVALID,
  CONTROL_HEIGHT,
  type ControlSize,
} from "./focus";
export { nextRovingIndex, type RovingInput, type RovingOrientation } from "./roving";
export { Input, type InputProps } from "./input";
export {
  NumberInput,
  clampNumber,
  formatNumberValue,
  parseNumberDraft,
  roundTo,
  stepNumber,
  type NumberDraft,
  type NumberInputProps,
} from "./number-input";
export { Field, fieldMessageIds, type FieldProps } from "./field";
export { Select, type SelectOption, type SelectProps } from "./select";
export { Switch, type SwitchProps } from "./switch";
export { RadioGroup, type RadioGroupProps, type RadioOption } from "./radio-group";
export { Badge, type BadgeProps, type BadgeTone } from "./badge";
export { Banner, type BannerProps, type BannerTone } from "./banner";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export {
  Spinner,
  LoadingState,
  type SpinnerProps,
  type SpinnerSize,
  type LoadingStateProps,
} from "./spinner";
export { Kbd, type KbdProps } from "./kbd";
export {
  formatShortcut,
  matchesShortcut,
  parseShortcut,
  isMacPlatform,
  type ParsedShortcut,
  type ShortcutModifier,
} from "./shortcut";
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogBody,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
  type DialogHeaderProps,
  type DialogSize,
} from "./dialog";
export {
  DialogHost,
  confirmDialog,
  promptDialog,
  cancelAllDialogs,
  useDialogHostStore,
  type ConfirmDialogOptions,
  type PromptDialogOptions,
  type DialogRequest,
} from "./dialog-host";
export {
  Toaster,
  toast,
  showToast,
  dismissToast,
  clearToasts,
  useToastStore,
  TOAST_DEFAULT_MS,
  TOAST_ERROR_MS,
  type ToastAction,
  type ToastItem,
  type ToastOptions,
  type ToastTone,
} from "./toast";
export {
  ErrorBoundary,
  ErrorFallback,
  setErrorReporter,
  errorDetails,
  type ErrorBoundaryProps,
  type ErrorFallbackProps,
  type ErrorReporter,
  type ErrorReportContext,
} from "./error-boundary";
