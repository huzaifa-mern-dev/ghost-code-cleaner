# Ghost Code Cleaner

Ghost Code Cleaner is a powerful monorepo application designed to deeply crawl Shopify storefronts, identify orphaned "ghost" code (unused CSS, JS, and remnants of uninstalled apps), and safely purge them. It features a robust Puppeteer-based deep crawler, a comprehensive analysis engine, and a Next.js-powered dashboard for managing audits and theme optimization.

## 🏗️ Architecture

This project is structured as a monorepo using [Turborepo](https://turbo.build/) and `npm` workspaces. It consists of multiple independent packages and applications that work together.

### Apps (`/apps`)
- **`web`**: A modern Next.js application that serves as the user-facing dashboard for initiating crawls, reviewing orphaned code, and managing billing.
- **`api`**: The backend RESTful API that handles audit coordination, interacts with the PostgreSQL database, and coordinates the heavy lifting.

### Packages (`/packages`)
- **`crawler`**: A Puppeteer-based engine designed to traverse Shopify stores, execute interactions, monitor network/CDP traffic, and generate structured DOM/CSS usage snapshots.
- **`analyzer`**: Engine responsible for analyzing the crawler outputs and identifying unused assets or ghost code patterns.
- **`classifier`**: Machine learning or heuristic-based classification to categorize findings.
- **`shopify`**: Shared utilities for interacting with Shopify's API, including authentication and billing (with development bypasses).
- **`theme-editor`**: Tools for safely modifying and purging identified ghost code from Shopify themes.
- **`shared`**: Common utilities, types, and configurations shared across all workspaces.

## 🚀 Getting Started

### Prerequisites

- Node.js (>= 20.0.0)
- npm (>= 10.0.0)
- PostgreSQL (running locally or via Docker for Prisma)

### Installation

1. Install dependencies from the root directory:
   ```bash
   npm install
   ```

2. Setup environment variables:
   - Copy `.env.example` to `.env` in the root (and within specific apps if necessary).
   - Configure your `DATABASE_URL` and Shopify API credentials.

3. Initialize the database:
   ```bash
   npm run db:generate
   npm run db:push
   ```

### Running the Project

To start the development environment (which spins up both the `web` dashboard and `api` server):

```bash
npm run dev
```

### Other Useful Commands

- `npm run build`: Build all apps and packages for production.
- `npm run test`: Run test suites across the monorepo.
- `npm run lint`: Run ESLint across the workspaces.
- `npm run format`: Format code using Prettier.
- `npm run db:studio`: Open Prisma Studio to inspect the database.

## 🛠️ Tech Stack

- **Framework:** Next.js (App Router), Express/Node.js
- **Monorepo:** Turborepo, npm workspaces
- **Database:** PostgreSQL, Prisma ORM
- **Automation:** Puppeteer (Deep Crawling)
- **Styling:** Tailwind CSS
- **Language:** TypeScript

## 📄 License

Private repository. All rights reserved.
