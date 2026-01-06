import { Product, Table, Order, Recipe } from './types';

export const CURRENT_USER = {
  name: "Abebe Bikila",
  email: "abebe@tomocacoffee.com",
  avatar: "https://i.pravatar.cc/150?u=abebe"
};

export const BRANCHES = [
  { id: '1', name: 'Tomoca - Bole Atlas', status: 'Open', sales: 'ETB 45,200' },
  { id: '2', name: 'Tomoca - Piassa', status: 'Open', sales: 'ETB 38,150' },
  { id: '3', name: 'Tomoca - Sar Bet', status: 'Maintenance', sales: 'ETB 0' },
];

export const TABLES: Table[] = [
  { id: '1', name: 'T-01', area: 'Main Hall', status: 'Occupied', seats: 4, orderTotal: 850, time: '35m' },
  { id: '2', name: 'T-02', area: 'Main Hall', status: 'Free', seats: 2 },
  { id: '3', name: 'T-03', area: 'Main Hall', status: 'Payment', seats: 6, orderTotal: 2450, time: '1h 20m' },
  { id: '4', name: 'T-04', area: 'Patio', status: 'Reserved', seats: 4, time: '19:00' },
  { id: '5', name: 'T-05', area: 'Bar Area', status: 'Free', seats: 2 },
  { id: '6', name: 'T-06', area: 'Private Room', status: 'Occupied', seats: 8, orderTotal: 5600, time: '15m' },
];

export const PRODUCTS: Product[] = [
  { id: '1', code: 'PRD1', name: 'Macchiato', price: 65, category: 'Coffee', stock: 500, image: 'https://images.unsplash.com/photo-1541167760496-1628856ab772?auto=format&fit=crop&q=80&w=200', description: 'Classic Ethiopian macchiato with a smooth crema finish.' },
  { id: '2', code: 'PRD2', name: 'Special Tibs', price: 650, category: 'Food', stock: 45, image: 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?auto=format&fit=crop&q=80&w=200', description: 'Sautéed beef tibs served with house spices and sides.' },
  { id: '3', code: 'PRD3', name: 'Fasting Firfir', price: 180, category: 'Food', stock: 30, image: 'https://images.unsplash.com/photo-1604382354936-07c5d9983bd3?auto=format&fit=crop&q=80&w=200', description: 'Traditional fasting firfir with berbere and herbs.' },
  { id: '4', code: 'PRD4', name: 'Spris Juice', price: 120, category: 'Drinks', stock: 100, image: 'https://images.unsplash.com/photo-1621506289937-a8e4df240d0b?auto=format&fit=crop&q=80&w=200', description: 'Fresh layered spris juice, chilled and vibrant.' },
  { id: '5', code: 'PRD5', name: 'Chechebsa', price: 250, category: 'Breakfast', stock: 20, image: 'https://images.unsplash.com/photo-1595295333158-4742f28fbd85?auto=format&fit=crop&q=80&w=200', description: 'Warm chechebsa with spiced butter and honey notes.' },
];

export const RECIPES: Recipe[] = [
  {
    productId: '1',
    productName: 'Macchiato',
    totalCost: 18.50,
    ingredients: [
      { ingredientId: 'INV-001', name: 'Coffee Beans (Jimma)', quantity: 0.018, cost: 8.10 },
      { ingredientId: 'INV-002', name: 'Farm Milk', quantity: 0.15, cost: 9.00 },
      { ingredientId: 'INV-005', name: 'Sugar', quantity: 0.01, cost: 1.40 }
    ]
  },
  {
    productId: '2',
    productName: 'Special Tibs',
    totalCost: 240.00,
    ingredients: [
      { ingredientId: 'INV-009', name: 'Meat (Beef)', quantity: 0.35, cost: 180.00 },
      { ingredientId: 'INV-010', name: 'Onion', quantity: 0.1, cost: 20.00 },
      { ingredientId: 'INV-011', name: 'Butter (Kibe)', quantity: 0.05, cost: 40.00 }
    ]
  }
];

export const SCHEDULE = [
  { staff: 'Abebe Bikila', mon: '08:00 - 16:00', tue: '08:00 - 16:00', wed: 'Off', thu: '08:00 - 16:00', fri: '08:00 - 16:00', sat: '08:00 - 14:00', sun: 'Off' },
  { staff: 'Selam Tesfaye', mon: '14:00 - 22:00', tue: '14:00 - 22:00', wed: '14:00 - 22:00', thu: 'Off', fri: '14:00 - 22:00', sat: '14:00 - 22:00', sun: '12:00 - 20:00' },
  { staff: 'Dawit Kebede', mon: 'Off', tue: '08:00 - 16:00', wed: '08:00 - 16:00', thu: '08:00 - 16:00', fri: 'Off', sat: '16:00 - 00:00', sun: '16:00 - 00:00' },
];

export const RECENT_ORDERS: Order[] = [
  { id: '#ORD-992', table: 'T-04', items: '2x Macchiato, 1x Tiramisu', total: 350, status: 'Cooking', time: '5m ago', staff: 'Selam' },
  { id: '#ORD-991', table: 'Takeaway', items: '1x Special Tibs', total: 650, status: 'Ready', time: '12m ago', staff: 'Dawit' },
  { id: '#ORD-990', table: 'T-12', items: '3x Ambo Water', total: 120, status: 'Served', time: '18m ago', staff: 'Selam' },
  { id: '#ORD-989', table: 'T-01', items: '4x Buna, 1x Popcorn', total: 200, status: 'Paid', time: '25m ago', staff: 'Tigist' },
  { id: '#ORD-988', table: 'T-06', items: '2x Kitfo (Special)', total: 1800, status: 'Served', time: '30m ago', staff: 'Dawit' },
];

export const STATS = [
  { label: 'Total Sales', value: 'ETB 124,500', trend: '+12%', icon: 'payments', positive: true },
  { label: 'Net Profit', value: 'ETB 42,100', trend: '+5%', icon: 'account_balance_wallet', positive: true },
  { label: 'Total Orders', value: '142', trend: '0%', icon: 'receipt_long', positive: false },
  { label: 'Avg Ticket', value: 'ETB 876', trend: '-2%', icon: 'sell', positive: false },
];

export const SYSTEM_STATS = [
  { label: 'Total Tenants', value: '124', trend: '+4 New', icon: 'store', positive: true },
  { label: 'Recurring Revenue', value: 'ETB 2.4M', trend: '+8.5%', icon: 'payments', positive: true },
  { label: 'Active Branches', value: '482', trend: '+12', icon: 'domain', positive: true },
  { label: 'System Load', value: '24%', trend: 'Stable', icon: 'memory', positive: true },
];

export const INVENTORY_ITEMS = [
  { id: 'INV-001', name: 'Coffee Beans (Jimma)', category: 'Raw Material', stock: 45, unit: 'kg', minStock: 10, price: 450, status: 'In Stock' },
  { id: 'INV-002', name: 'Farm Milk', category: 'Dairy', stock: 12, unit: 'L', minStock: 20, price: 60, status: 'Low Stock' },
  { id: 'INV-003', name: 'Teff Flour (Magna)', category: 'Raw Material', stock: 150, unit: 'kg', minStock: 50, price: 85, status: 'In Stock' },
  { id: 'INV-004', name: 'Ambo Water (Glass)', category: 'Drinks', stock: 240, unit: 'btl', minStock: 48, price: 25, status: 'In Stock' },
  { id: 'INV-005', name: 'Sugar', category: 'Raw Material', stock: 8, unit: 'kg', minStock: 15, price: 90, status: 'Critical' },
  { id: 'INV-009', name: 'Meat (Beef)', category: 'Raw Material', stock: 50, unit: 'kg', minStock: 10, price: 500, status: 'In Stock' },
  { id: 'INV-010', name: 'Onion', category: 'Vegetable', stock: 30, unit: 'kg', minStock: 5, price: 40, status: 'In Stock' },
  { id: 'INV-011', name: 'Butter (Kibe)', category: 'Dairy', stock: 15, unit: 'kg', minStock: 2, price: 800, status: 'In Stock' },
];

export const STAFF_LIST = [
  { id: 'STF-001', name: 'Abebe Bikila', role: 'Branch Manager', phone: '+251 911 234 567', status: 'Active', shift: 'Morning', avatar: 'https://i.pravatar.cc/150?u=abebe' },
  { id: 'STF-002', name: 'Selam Tesfaye', role: 'Cashier', phone: '+251 922 345 678', status: 'Active', shift: 'Afternoon', avatar: 'https://i.pravatar.cc/150?u=selam' },
  { id: 'STF-003', name: 'Dawit Kebede', role: 'Waiter', phone: '+251 933 456 789', status: 'On Leave', shift: 'Night', avatar: 'https://i.pravatar.cc/150?u=dawit' },
  { id: 'STF-004', name: 'Tigist Alemu', role: 'Head Chef', phone: '+251 944 567 890', status: 'Active', shift: 'Morning', avatar: 'https://i.pravatar.cc/150?u=tigist' },
];

export const TRANSACTIONS = [
  { id: 'TRX-9981', type: 'Income', category: 'Sales', amount: 4500, date: 'Oct 24, 10:30 AM', desc: 'Morning Rush Sales' },
  { id: 'TRX-9980', type: 'Expense', category: 'Inventory', amount: 12000, date: 'Oct 24, 09:15 AM', desc: 'Restock Coffee Beans' },
  { id: 'TRX-9979', type: 'Income', category: 'Sales', amount: 3200, date: 'Oct 23, 08:45 PM', desc: 'Dinner Service' },
  { id: 'TRX-9978', type: 'Expense', category: 'Utilities', amount: 4500, date: 'Oct 23, 02:00 PM', desc: 'Electricity Bill (EeU)' },
  { id: 'TRX-9977', type: 'Expense', category: 'Rent', amount: 65000, date: 'Oct 01, 09:00 AM', desc: 'Monthly Shop Rent' },
];

export const TENANTS_LIST = [
  { id: 'TNT-001', name: 'Tomoca Coffee', plan: 'Enterprise', branches: 8, status: 'Active', nextBilling: 'Nov 01, 2024' },
  { id: 'TNT-002', name: 'Kaldi\'s Coffee', plan: 'Enterprise', branches: 42, status: 'Active', nextBilling: 'Nov 01, 2024' },
  { id: 'TNT-003', name: 'Jupiter Hotel Cafe', plan: 'Professional', branches: 1, status: 'Active', nextBilling: 'Oct 28, 2024' },
  { id: 'TNT-004', name: 'Village Cafe', plan: 'Starter', branches: 1, status: 'Past Due', nextBilling: 'Oct 15, 2024' },
];
