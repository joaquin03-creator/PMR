# Project Instructions: Preferred Metals & Recycling

## Google Sheets Sync Architecture
The application uses a robust, multi-layered sync system to import material prices from Google Sheets. This was implemented to overcome CORS restrictions and flexible user formatting.

### 1. Full-Stack Proxy
- **File:** `server.ts`
- **Logic:** Uses an Express proxy at `/api/proxy-sheet` to fetch Google Sheets data server-side using `axios`. This bypasses browser CORS blocks and uses a standard User-Agent to prevent bot-detection issues.
- **Dependency:** `axios` must remain in `package.json`.

### 2. Smart Column Discovery (ManagePrices.tsx)
- **Header Discovery:** Scans the first 20 rows of the CSV to find the actual header row (looking for keywords like "Code" and "Price").
- **Data-Driven Fallback:** If headers aren't found by name, it scans the first row of data for values that match existing material codes (e.g., "CU-1") to identify the "Code" column automatically.
- **Seeding Mode:** A toggle allows for "Seeding Mode". When active, the sync will create NEW material records if the code doesn't exist. It also pulls `Name`, `Category`, and `Unit` if columns are present.
- **Fuzzy Matching:** Uses a `findColumn` helper with extensive keyword aliases (e.g., `sku`, `partnumber`, `buyrate`, `cost`, `description`) and normalizes strings (lowercase, trim, remove special characters).
- **Auto-Delimiter:** `Papa.parse` is configured with `delimiter: ""` to automatically detect commas, semicolons, or tabs.

### 3. Troubleshooting UI
- **Debug Data View:** If sync fails or headers aren't found, a "Debug Data" table appears in the UI showing exactly what the app read from the CSV. This must be preserved for user support.

## Security Rules
- **Pricing Snapshots:** Managers can create snapshots. Cashiers can view them.
- **Material Updates:** Only Managers can update material prices.
- **Validation:** Always use `hasRequiredFields` and `isValidSnapshot` helpers in `firestore.rules`.

## Development Notes
- The app is **Full-Stack**. The `dev` script in `package.json` must always be `"tsx server.ts"`.
- Do not revert to a pure client-side Vite setup without migrating the proxy logic.
