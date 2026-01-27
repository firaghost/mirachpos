import React from 'react';
import * as Icons from 'lucide-react';

export type AppIconName = keyof typeof Icons | string;

const materialToLucide: Record<string, keyof typeof Icons> = {
  account_balance: 'Landmark',
  account_balance_wallet: 'Wallet',
  add: 'Plus',
  add_business: 'Store',
  add_circle: 'PlusCircle',
  admin_panel_settings: 'ShieldCheck',
  auto_awesome: 'Sparkles',
  bar_chart: 'BarChart2',
  campaign: 'Megaphone',
  analytics: 'BarChart3',
  arrow_back: 'ArrowLeft',
  arrow_downward: 'ArrowDown',
  arrow_forward: 'ArrowRight',
  arrow_upward: 'ArrowUp',
  assessment: 'ClipboardList',
  attach_money: 'DollarSign',
  attachment: 'Paperclip',
  autorenew: 'RefreshCw',
  backspace: 'Delete',
  badge: 'BadgeCheck',
  block: 'Ban',
  build: 'Wrench',
  calculate: 'Calculator',
  calendar_clock: 'CalendarClock',
  calendar_month: 'Calendar',
  calendar_today: 'CalendarDays',
  call: 'Phone',
  call_split: 'Split',
  cancel: 'XCircle',
  category: 'Shapes',
  check: 'Check',
  check_circle: 'CheckCircle',
  chevron_left: 'ChevronLeft',
  chevron_right: 'ChevronRight',
  close: 'X',
  close_fullscreen: 'Minimize2',
  coffee_maker: 'Coffee',
  cloud_upload: 'CloudUpload',
  contacts: 'Users',
  content_copy: 'Copy',
  credit_card: 'CreditCard',
  dark_mode: 'Moon',
  database: 'Database',
  dashboard: 'LayoutDashboard',
  delete: 'Trash2',
  dns: 'Server',
  dock_to_right: 'PanelRightOpen',
  domain: 'Globe',
  done_all: 'CheckCheck',
  download: 'Download',
  edit: 'Pencil',
  edit_document: 'FilePenLine',
  edit_note: 'StickyNote',
  error: 'AlertCircle',
  expand_more: 'ChevronDown',
  extension: 'Puzzle',
  file_download: 'Download',
  filter_alt: 'Filter',
  filter_list: 'ListFilter',
  fingerprint: 'Fingerprint',
  flag: 'Flag',
  gavel: 'Gavel',
  grid_on: 'Grid',
  grid_view: 'LayoutGrid',
  group: 'Users',
  groups: 'Users2',
  help: 'HelpCircle',
  history: 'History',
  history_edu: 'GraduationCap',
  inbox: 'Inbox',
  manage_accounts: 'UserCog',
  inventory: 'Package',
  inventory_2: 'PackageOpen',
  keyboard_arrow_down: 'ChevronDown',
  kitchen: 'Soup',
  layers: 'Layers',
  leaderboard: 'Trophy',
  light_mode: 'Sun',
  link_off: 'Link2Off',
  list_alt: 'List',
  local_bar: 'Martini',
  location_on: 'MapPin',
  lock: 'Lock',
  logout: 'LogOut',
  mail: 'Mail',
  menu_book: 'BookOpen',
  monitor_heart: 'ActivitySquare',
  monitoring: 'Activity',
  more_horiz: 'MoreHorizontal',
  more_vert: 'MoreVertical',
  notifications: 'Bell',
  notifications_active: 'BellRing',
  paid: 'BadgeDollarSign',
  palette: 'Palette',
  payments: 'CreditCard',
  pending: 'Clock',
  pending_actions: 'ClipboardClock',
  percent: 'Percent',
  person: 'User',
  person_add: 'UserPlus',
  photo: 'Image',
  picture_as_pdf: 'FileText',
  pie_chart: 'PieChart',
  point_of_sale: 'Store',
  policy: 'Shield',
  price_change: 'ArrowUpDown',
  print: 'Printer',
  print_connect: 'Printer',
  public: 'Globe2',
  qr_code_2: 'QrCode',
  query_stats: 'LineChart',
  receipt: 'Receipt',
  receipt_long: 'Receipt',
  restaurant_menu: 'MenuSquare',
  refresh: 'RefreshCw',
  remove: 'Minus',
  report: 'FileWarning',
  restaurant: 'Utensils',
  room_service: 'ConciergeBell',
  router: 'Router',
  save: 'Save',
  savings: 'PiggyBank',
  schedule: 'Clock',
  schedule_send: 'Send',
  science: 'FlaskConical',
  search: 'Search',
  security: 'ShieldCheck',
  settings: 'Settings',
  space_dashboard: 'LayoutDashboard',
  support_agent: 'LifeBuoy',
  shield: 'Shield',
  shield_person: 'ShieldUser',
  shopping_basket: 'ShoppingBasket',
  shopping_cart: 'ShoppingCart',
  skillet: 'UtensilsCrossed',
  sort: 'ArrowUpDown',
  soup_kitchen: 'Soup',
  speed: 'Gauge',
  store: 'Store',
  storefront: 'Store',
  swap_horiz: 'ArrowLeftRight',
  sync: 'RefreshCw',
  table_restaurant: 'Table',
  table_view: 'Table',
  toggle_on: 'ToggleRight',
  trending_down: 'TrendingDown',
  trending_flat: 'ArrowRight',
  trending_up: 'TrendingUp',
  tune: 'Sliders',
  upload: 'Upload',
  verified: 'BadgeCheck',
  verified_user: 'ShieldCheck',
  visibility: 'Eye',
  warning: 'AlertTriangle',
  widgets: 'LayoutGrid',
  wifi: 'Wifi',
};

interface AppIconProps {
  name: AppIconName;
  className?: string;
  size?: number;
  strokeWidth?: number;
  label?: string;
}

const textSizeMap: Record<string, number> = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
  '5xl': 48,
  '6xl': 60,
};

const resolveSize = (className?: string, explicitSize?: number) => {
  if (explicitSize) return explicitSize;
  if (!className) return 18;

  const pxMatch = className.match(/text-\[(\d+)px\]/);
  if (pxMatch) return Number(pxMatch[1]);

  const tokenMatch = className.match(/\btext-(xs|sm|base|lg|xl|2xl|3xl|4xl|5xl|6xl)\b/);
  if (tokenMatch) return textSizeMap[tokenMatch[1]] || 18;

  return 18;
};

export const AppIcon: React.FC<AppIconProps> = ({ name, className, size, strokeWidth = 2, label }) => {
  const resolvedName = materialToLucide[String(name)] || String(name);
  const IconComponent = (Icons as Record<string, Icons.LucideIcon>)[resolvedName] || Icons.Circle;
  const resolvedSize = resolveSize(className, size);

  return (
    <IconComponent
      className={className}
      size={resolvedSize}
      strokeWidth={strokeWidth}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      focusable={false}
    />
  );
};
