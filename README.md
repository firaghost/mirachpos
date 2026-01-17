<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MirachPOS

MirachPOS is a comprehensive, role-based Point of Sale (POS) system designed for restaurants and cafes. It's built with a modern tech stack, including React, TypeScript, and Electron, to provide a seamless experience on both web and desktop platforms.

## Key Technologies

- **Frontend:** React, Vite, TypeScript
- **Desktop:** Electron
- **Backend:** Node.js, Express
- **Database:** SQLite
- **Styling:** Tailwind CSS

## Features by Role

MirachPOS offers a tailored experience for each role within a restaurant or cafe environment:

### Waiter & Waiter Manager

-   **Floor Plan Management:** Visualize and manage tables.
-   **Order Taking:** A streamlined interface for taking customer orders.
-   **Kitchen Display System (KDS):** Real-time order status tracking.
-   **Payment Processing:** Handle cash, mobile payments (Telebirr, Chapa), and split bills.
-   **Receipt Printing:** Generate and print customer receipts.
-   **Shift Reports:** Track sales and performance for each shift.

### Branch Manager

-   **Dashboard:** An overview of the branch's performance.
-   **Menu & Recipe Management:** Create and update menus and recipes.
-   **Inventory Control:** Manage stock levels and supplies.
-   **Customer Management:** View and manage customer information.
-   **Staff Management:** Oversee and manage branch staff.
-   **Reporting:** Generate detailed reports on sales, inventory, and more.

### Cafe Owner

-   **Global Dashboard:** A high-level view of all branches.
-   **Onboarding:** A guided setup process for new branches.
-   **Branch Management:** Add, remove, and manage branches.
-   **Financial Oversight:** Track revenue and manage billing.
-   **Audit Logs:** Review system activity and changes.
-   **Subscription Management:** Manage the MirachPOS subscription and billing.

### Super Admin

-   **System Overview:** A comprehensive view of the entire MirachPOS ecosystem.
-   **Tenant Management:** Manage all the cafes and restaurants using the system.
-   **Feature Flags:** Enable or disable features for different tenants.
-   **System Health Monitoring:** Keep an eye on the system's performance and stability.
-   **Support:** Provide support to tenants.

## Getting Started

### Prerequisites

-   Node.js (v20.x or v22.x)
-   npm

### Installation

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/firaghost/mirachpos.git
    cd mirachpos
    ```

2.  **Install dependencies:**
    ```bash
    npm install
    ```

3.  **Set up environment variables:**

    Create a `.env.local` file in the root of the project and add your Gemini API key:

    ```
    GEMINI_API_KEY=your_gemini_api_key
    ```
    *Note: The `GEMINI_API_KEY` is likely used for features that leverage Google's Gemini AI, such as AI-powered sales predictions or customer sentiment analysis.*


### Running the Application

**For Web:**
```bash
npm run dev
```
This will start the Vite development server, and you can access the application at `http://localhost:3001`.

**For Desktop (with API):**
```bash
npm run dev:desktop
```
This will concurrently start the API server, the Vite development server, and the Electron application.

**For Desktop (without API):**
```bash
npm run dev:desktop:noapi
```
This will start the Vite development server and the Electron application, but not the API server. This is useful for focusing on frontend development.

## Architectural Insights

-   **Routing:** The application uses a hash-based screen router, with the main routing logic located in `App.tsx`.
-   **Session Management:** Sessions are primarily stored in `sessionStorage` and are broadcast across tabs.
-   **Role-Based Access Control (RBAC):** The application uses a sophisticated RBAC system to control access to different screens and features based on the user's role.

## Available Scripts

-   `npm run dev`: Starts the development server for the web application.
-   `npm run dev:api`: Starts the API server.
-   `npm run dev:desktop`: Starts the development environment for the desktop application.
-   `npm run build`: Creates a production build of the web application.
-   `npm run build:desktop`: Creates a production build of the desktop application.
-   `npm run dist:desktop`: Packages the desktop application for distribution.
-   `npm run dist:win`: Packages the desktop application for Windows.

## Building for Production

To create a distributable version of the desktop application, run:

```bash
npm run dist:desktop
```

This will create an installer for the application in the `release` directory.

## Contributing

We welcome contributions to MirachPOS! If you have a feature request, bug report, or want to contribute to the code, please feel free to open an issue or submit a pull request.

## License

This project is licensed under the MIT License. See the `LICENSE` file for more details.
