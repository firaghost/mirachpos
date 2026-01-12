# 📱 AI CODER MASTER PROMPT & WORKFLOW FOR WAITER + OWNER/MANAGER APPS

This file is designed so an **AI coder (Claude / GPT‑4 / etc.)** can build your **Ethiopian restaurant & café POS mobile apps** **step by step without hallucinating**.

- Apps:
  - **Waiter Mobile App**
  - **Shared Owner & Manager Mobile App**
- Tech Stack:
  - **React Native (Expo) + TypeScript**
  - **React Navigation**
  - **React Query**
  - **Context or Zustand for app state**
- Backend:
  - Existing or planned **REST API** for your POS
  - **JWT authentication**

Use this file as:
- A **master prompt** you paste into the AI at the start
- Then follow the **workflow sections** in order

---

## 0. HOW TO USE THIS DOCUMENT

1. **First message to the AI:** Paste Section **1. GLOBAL CONTEXT FOR AI CODER** completely.
2. Then follow the workflow:
   - Phase 1: Project Setup
   - Phase 2: Auth & API client
   - Phase 3: Waiter App screens
   - Phase 4: Owner/Manager App screens
   - Phase 5: Offline + Polish + Testing
3. For each phase, copy the **exact prompt blocks** from this file and paste into the AI.
4. Never mix multiple phases in one message – keep each request focused.
5. When code touches APIs, always:
   - Provide **exact endpoint path**
   - Provide **example request & response JSON**

If the AI ever invents endpoints or data shapes, correct it using this rule:

> "Do not invent API endpoints or response fields. Only use the ones I explicitly provide. If missing, ask me to define them."

You can paste that line as needed.

---

## 1. GLOBAL CONTEXT FOR AI CODER (FIRST PROMPT)

Paste this as your **first message** to the AI before starting any implementation.

```text
You are a senior mobile engineer and architect.

Your job: Help me build TWO production-grade mobile apps for my Ethiopian restaurant & café POS, without hallucinating, using only the information I provide.

VERY IMPORTANT RULES (DO NOT BREAK):
1) Do NOT invent API endpoints, request fields, or response fields.
2) Do NOT invent database schema.
3) When something is missing, STOP and ask me:
   - "I need the exact endpoint path, method, and example request/response JSON."
4) If you are not 100% sure, ask a clarification question before coding.

### BUSINESS CONTEXT (DO NOT CHANGE)

- Country: Ethiopia
- Product: Restaurant & Café POS platform
- Mobile apps:
  1) Waiter App (for waiters to manage tables, orders, and serving)
  2) Shared Owner & Manager App (for owners and branch managers to see KPIs and control operations)

- Backend:
  - There is or will be a REST API backend for the POS.
  - Authentication uses JWT.
  - Mobile apps are API CLIENTS ONLY, they do NOT contain backend logic.

### TECH STACK (FIXED)

You MUST use this stack unless I explicitly approve a change:

- Mobile framework: React Native with Expo
- Language: TypeScript
- Navigation: React Navigation (stack + bottom tabs)
- Server state: React Query (@tanstack/react-query)
- App state: React Context or Zustand (keep it simple)
- HTTP client: axios
- UI: Any simple, free component approach (basic RN + StyleSheet or NativeWind or React Native Paper). Keep it lightweight.

### APPS

1) WAITER APP – MAIN FLOWS
   - Login as waiter
   - See tables list with status (Free, Occupied, Awaiting Payment)
   - Open new order for a table
   - Add items from menu (with optional modifiers like "no sugar")
   - See current order status (Sent to kitchen, Preparing, Ready, Served)
   - Mark items as served
   - View bill summary for the table
   - Signal "Ready to pay" to the cashier/POS

2) OWNER/MANAGER APP – MAIN FLOWS
   - Login as owner or manager (role-based)
   - Owner:
     - See KPIs for ALL branches:
       - Total sales today / week / month
       - Top-selling items
       - Top branches by sales
   - Manager:
     - See KPIs for ONLY their branch:
       - Sales today
       - Number of active tables
       - Number of open orders
   - Both:
     - See basic dashboards
     - (Later) Configure settings like open hours, etc.

### YOUR RESPONSIBILITIES

- Propose and implement:
  - Project structure
  - Navigation structure
  - Shared utilities (auth, API client)
  - Screen implementations (with TypeScript types)
  - Basic error and loading handling
  - Offline-friendly patterns where reasonable (React Query caching)

- Every time you write code:
  - Show the FULL content of new files.
  - For existing files, show only the changed sections, but be clear where they go.
  - Comment your code where non-trivial.

- Every time you use an API:
  - Use ONLY endpoints that I explicitly defined.
  - If I did not define an endpoint, STOP and ask me for its exact path and example JSON.

Reply now by briefly restating this context in your own words and then propose a high-level plan with phases. After that, wait for me to confirm before writing any code.
```

---

## 2. WORKFLOW OVERVIEW (PHASES)

Use this section to keep both you and the AI on track.

1. **Phase 1 – Project Setup & Structure**
   - Create Expo project(s)
   - Setup TypeScript, navigation, React Query, basic folder structure

2. **Phase 2 – Auth & API Client**
   - Implement common auth flow
   - Implement axios client
   - Implement basic `/auth/login` and `/me` integration

3. **Phase 3 – Waiter App Core Screens**
   - Tables list
   - New order flow
   - Order details & status
   - Bill summary

4. **Phase 4 – Owner/Manager App Core Screens**
   - Role-based home dashboard
   - Sales summary
   - Basic staff/branch views

5. **Phase 5 – Offline, Polish, Testing & Builds**
   - React Query cache
   - Simple queued actions (optional)
   - Basic Jest tests
   - Expo build for Android

For each phase there is a dedicated prompt below.

---

## 3. PHASE 1 – PROJECT SETUP PROMPT

Use this when you are ready to create the project.

```text
We are now in PHASE 1: PROJECT SETUP.

Use the global context from before. Do NOT change the tech stack.

Goals of this phase:
1) Choose project structure
2) Create Expo TypeScript project(s)
3) Install dependencies
4) Define initial folder structure and base navigation shells

### 1) PROJECT STRUCTURE

I want you to recommend ONE of these options and explain why:
- Option A: One monorepo with two apps:
  - /apps/waiter-app
  - /apps/owner-manager-app
  - /packages/ui (shared components)
- Option B: Two completely separate Expo projects

I care about:
- Easy to maintain
- Not over-engineered
- Works well with AI-generated code

Pick one option and justify it in 3-5 bullet points.

### 2) EXPO & DEPENDENCIES

Then, provide exact terminal commands to:
- Initialize the app(s) with Expo + TypeScript
- Install these libraries:
  - @react-navigation/native
  - @react-navigation/native-stack
  - @react-navigation/bottom-tabs
  - @tanstack/react-query
  - axios
  - Zustand OR Context tooling
  - Optional UI library you pick (simple and free)

Include a sample `package.json` dependencies section for one of the apps.

### 3) FOLDER STRUCTURE

Propose and then finalize a folder structure for each app, for example:
- src/
  - screens/
  - components/
  - navigation/
  - hooks/
  - services/
  - context/
  - types/

Give the folder structure as a tree, and **do not create any files yet**.

### 4) BASE NAVIGATION SHELLS

Describe, in detail, the navigation structure you will implement next:

- WAITER APP:
  - Root: Stack navigator
  - Inside: Bottom tabs with [Tables, Orders, Profile]

- OWNER/MANAGER APP:
  - Root: Stack navigator
  - Inside: Bottom tabs with [Home, Sales, Staff, Settings]

Do NOT write code yet. Just:
- Choose structure
- Give commands
- Define folders
- Describe navigation plan

After you do this, STOP and wait for my confirmation.
```

---

## 4. PHASE 2 – AUTH & API CLIENT PROMPT

Once structure is approved and created, move to auth & API.

Before sending this prompt, define your real auth endpoints, for example:

```text
AUTH ENDPOINTS (USE ONLY THESE):
- POST /auth/login
  Request: { "username": string, "password": string }
  Response: { "token": string }

- GET /auth/me
  Headers: Authorization: Bearer <token>
  Response:
  {
    "id": string,
    "name": string,
    "role": "WAITER" | "OWNER" | "MANAGER",
    "branch_id": string | null
  }
```

Then paste this prompt:

```text
We are now in PHASE 2: AUTH & API CLIENT.

Use the previously agreed project structure and tech stack.

### IMPORTANT RULES
- Use ONLY these auth endpoints (do not invent new fields or paths):
  - POST /auth/login
  - GET /auth/me
- If you need more fields, ask me first.

### GOALS OF THIS PHASE
1) Implement API client module using axios + TypeScript
2) Implement AuthContext (or Zustand store) to store token & user
3) Implement:
   - Splash/loading screen
   - Login screen
   - Authenticated vs unauthenticated navigation switch

### 1) API CLIENT

Create a file: `src/services/apiClient.ts` with:
- axios instance with baseURL from env/config
- Interceptor to attach Authorization header when token exists
- Interceptor to handle 401 (unauthorized) by clearing auth state (we will wire this later)

Show full code for apiClient.ts.

### 2) AUTH CONTEXT / STORE

Implement a simple AuthProvider using React Context OR Zustand with:
- State:
  - token: string | null
  - user: { id, name, role, branch_id } | null
  - isLoading: boolean
- Actions:
  - login(username, password)
  - logout()
  - bootstrap() – called on app start to restore token and fetch /auth/me

Use AsyncStorage or SecureStore for persisting token (prefer SecureStore if simple with Expo).

Show full code for:
- src/context/AuthContext.tsx (or store)
- src/hooks/useAuth.ts (if you create a hook)

### 3) NAVIGATION INTEGRATION

Implement high-level navigation switch:

- If `isLoading` → show SplashScreen
- Else if `!token` → show AuthStack (Login screen)
- Else → show AppStack (main app with tabs)

Show:
- src/navigation/RootNavigator.tsx (or equivalent)
- src/screens/auth/LoginScreen.tsx – simple UI with username/password inputs + login button

The LoginScreen should:
- Use `useAuth()`
- Call `login(username, password)` with form data
- Show loading state and error messages if login fails

After writing all this code, STOP and wait for my review.

If anything is unclear, ask me questions BEFORE coding.
```

---

## 5. PHASE 3 – WAITER APP CORE SCREENS PROMPT

Before this phase, you must define the exact APIs for waiter flows.

Example definitions you give to the AI (adjust to your backend):

```text
WAITER API ENDPOINTS (USE ONLY THESE):

- GET /waiter/tables
  Response: [
    {
      "id": string,
      "name": string,
      "status": "FREE" | "OCCUPIED" | "AWAITING_PAYMENT",
      "current_order_id": string | null,
      "guest_count": number | null
    }
  ]

- GET /waiter/menu
  Response: [
    {
      "id": string,
      "name": string,
      "category": string,
      "price": number,
      "is_available": boolean
    }
  ]

- POST /waiter/orders
  Request:
  {
    "table_id": string,
    "items": [
      { "menu_item_id": string, "quantity": number, "note"?: string }
    ]
  }
  Response:
  {
    "id": string,
    "table_id": string,
    "status": "SENT_TO_KITCHEN",
    "total": number
  }

- GET /waiter/orders/:orderId
  Response:
  {
    "id": string,
    "table_id": string,
    "status": "SENT_TO_KITCHEN" | "PREPARING" | "READY" | "SERVED",
    "items": [
      {
        "id": string,
        "menu_item_id": string,
        "name": string,
        "quantity": number,
        "note": string | null,
        "status": "PENDING" | "PREPARING" | "READY" | "SERVED"
      }
    ],
    "total": number
  }

- POST /waiter/orders/:orderId/serve
  Request: { "item_ids": string[] }
  Response: { "success": true }

- GET /waiter/orders/:orderId/bill
  Response:
  {
    "order_id": string,
    "table_name": string,
    "items": [
      { "name": string, "quantity": number, "price": number, "total": number }
    ],
    "subtotal": number,
    "tax": number,
    "total": number
  }
```

Then use this prompt:

```text
We are now in PHASE 3: WAITER APP CORE SCREENS.

Use the agreed endpoints ONLY. Do not add fields. If you feel something is missing, ask me before inventing it.

### GOALS OF THIS PHASE

Implement these screens for the WAITER APP:
1) TableListScreen
2) NewOrderScreen
3) OrderDetailsScreen
4) BillScreen (view-only)

### GENERAL REQUIREMENTS

- Use React Query for all server data (tables, menu, orders, bills).
- Put data-fetching hooks into `src/hooks/waiter/`.
- Put screens into `src/screens/waiter/`.
- Use simple, clear UI – focus on functionality.

### 1) TABLELISTSCREEN

Implement `src/screens/waiter/TableListScreen.tsx`:
- Fetch tables from GET /waiter/tables using a hook `useWaiterTables()`.
- Show:
  - Table name
  - Status badge with colors:
    - FREE = green
    - OCCUPIED = orange
    - AWAITING_PAYMENT = white
  - Guest count if available.
- On press:
  - If status = FREE → navigate to NewOrderScreen with tableId
  - Else → navigate to OrderDetailsScreen with orderId

Provide:
- Hook: `useWaiterTables` in `src/hooks/waiter/useWaiterTables.ts`
- Full TableListScreen code.

### 2) NEWORDERSCREEN

Implement `src/screens/waiter/NewOrderScreen.tsx`:
- Receives `tableId` from route params.
- Fetch menu via GET /waiter/menu using `useWaiterMenu()` hook.
- UI:
  - Category filter (simple buttons at top)
  - List of items with name + price.
  - Quantity selector for each item (e.g., +/- buttons).
  - Optional note per item (text input modal).
- On "Submit Order":
  - Call POST /waiter/orders with selected items.
  - On success → navigate to OrderDetailsScreen(orderId).

Provide:
- Hook: `useWaiterMenu` in `src/hooks/waiter/useWaiterMenu.ts`
- Helper hook: `useCreateOrder` in `src/hooks/waiter/useCreateOrder.ts`
- Full NewOrderScreen code.

### 3) ORDERDETAILSSCREEN

Implement `src/screens/waiter/OrderDetailsScreen.tsx`:
- Receives `orderId` in params.
- Fetch order via GET /waiter/orders/:orderId using `useWaiterOrder(orderId)`.
- Show:
  - Table name (if available)
  - Order status
  - List of items with status (PENDING/PREPARING/READY/SERVED).
- Allow waiter to mark selected items as served via POST /waiter/orders/:orderId/serve.

Provide:
- Hook: `useWaiterOrder` in `src/hooks/waiter/useWaiterOrder.ts`
- Hook: `useServeOrderItems` in `src/hooks/waiter/useServeOrderItems.ts`
- Full OrderDetailsScreen code.

### 4) BILL SCREEN

Implement `src/screens/waiter/BillScreen.tsx`:
- Receives `orderId`.
- Fetch bill via GET /waiter/orders/:orderId/bill using `useWaiterBill(orderId)`.
- Show bill in a simple, readable layout.
- READ-ONLY for now (no payments from this app).

Provide:
- Hook: `useWaiterBill` in `src/hooks/waiter/useWaiterBill.ts`
- Full BillScreen code.

### NAVIGATION WIRING

Update waiter app navigation to include these screens correctly.
Show the updated navigation file(s), including type-safe route params.

After coding, stop and summarize what you did.
```

---

## 6. PHASE 4 – OWNER/MANAGER APP CORE SCREENS PROMPT

Define your exact owner/manager endpoints first. Example:

```text
OWNER/MANAGER ENDPOINTS (USE ONLY THESE):

- GET /owner/dashboard/summary
  Response:
  {
    "today_sales": number,
    "week_sales": number,
    "month_sales": number,
    "total_branches": number
  }

- GET /owner/dashboard/top-branches
  Response: [
    {
      "branch_id": string,
      "branch_name": string,
      "today_sales": number
    }
  ]

- GET /manager/dashboard/summary
  Response:
  {
    "branch_id": string,
    "branch_name": string,
    "today_sales": number,
    "open_tables": number,
    "open_orders": number
  }

- GET /manager/dashboard/live-tables
  Response: [
    {
      "table_id": string,
      "table_name": string,
      "status": "FREE" | "OCCUPIED" | "AWAITING_PAYMENT"
    }
  ]
```

Then send this prompt:

```text
We are now in PHASE 4: OWNER/MANAGER APP CORE SCREENS.

Use ONLY the endpoints I provided. Do not invent fields.

### GOALS OF THIS PHASE

Implement initial dashboards for the OWNER/MANAGER app:
1) HomeScreen (role-based)
2) SalesScreen (basic)

### GENERAL REQUIREMENTS

- Use `useAuth()` to get `user.role` and `user.branch_id`.
- OWNER sees multi-branch data.
- MANAGER sees only their branch.

### 1) HOMESCREEN

Implement `src/screens/ownerManager/HomeScreen.tsx`:

- If user.role = "OWNER":
  - Fetch:
    - GET /owner/dashboard/summary
    - GET /owner/dashboard/top-branches
  - UI:
    - Cards for today/week/month sales
    - List of top branches (name + today_sales)

- If user.role = "MANAGER":
  - Fetch:
    - GET /manager/dashboard/summary
    - GET /manager/dashboard/live-tables
  - UI:
    - Card: branch name
    - Card: today_sales
    - Card: open_tables
    - Card: open_orders
    - List of live tables with status

Implementation details:
- Create hooks in `src/hooks/dashboard/`:
  - useOwnerDashboardSummary
  - useOwnerTopBranches
  - useManagerDashboardSummary
  - useManagerLiveTables
- Use React Query in all hooks.

Provide:
- Full HomeScreen code
- All hooks code

### 2) SALESSCREEN (BASIC)

Implement `src/screens/ownerManager/SalesScreen.tsx`:
- For now, use same endpoints as HomeScreen but focus on charts/graphs later.
- Show date range picker UI (just local state for now).
- Show simple list of sales metrics.

### NAVIGATION

Wire HomeScreen and SalesScreen into Owner/Manager bottom tabs.
Show updated navigation code.

After coding, stop and summarize.
```

---

## 7. PHASE 5 – OFFLINE, POLISH, TESTING & BUILDS PROMPT

Use this when core flows work.

```text
We are now in PHASE 5: OFFLINE, POLISH, TESTING & BUILDS.

GOALS:
1) Improve offline behavior using React Query
2) Add basic error handling & toasts
3) Add a few Jest tests for hooks
4) Show me how to build an Android APK with Expo

### 1) OFFLINE BEHAVIOR

- Configure React Query with:
  - Reasonable staleTime for tables and dashboard data
  - Retry settings (max retries, backoff)
- For waiter app:
  - Ensure last fetched tables list and orders can still be viewed offline
  - If offline when trying to create an order, explain a simple queuing approach but DO NOT overcomplicate.

Show:
- React Query client setup file
- Any changes to hooks to enable better cache usage.

### 2) ERROR HANDLING & TOASTS

- Implement a simple global error handler using Context or a small library.
- Show a simple toast/banner when network errors occur.
- Add error UI states for:
  - Tables list
  - Dashboard

### 3) TESTING

- Add Jest + React Testing Library setup for one app.
- Write at least 2 example tests:
  - One hook test (e.g., useWaiterTables with mocked API)
  - One simple component test (e.g., TableListScreen renders table names)

### 4) BUILDS

- Provide exact Expo commands to:
  - Run app on device with Expo Go
  - Build Android APK or AAB for distribution

Stop after providing code/config and instructions.
```

---

## 8. EXTRA SAFETY: ANTI-HALLUCINATION REMINDER

If at any time the AI starts inventing things, paste this reminder:

```text
REMINDER:
- Do NOT invent endpoints or fields.
- Use ONLY the API shapes I provide.
- If something is missing, ask me to define it.
- If unsure, stop and ask.
```

---

## 9. SUMMARY

This markdown file:
- Gives the AI **full business + tech context**
- Splits work into **clear phases**
- Provides **exact prompts** so the AI stays grounded
- Forces the AI to **ask for missing API details** instead of hallucinating

Use it step by step, copying only the relevant phase prompt each time.

You now have a **clear, low-hallucination workflow** to get your waiter and owner/manager mobile apps built with an AI coder.
