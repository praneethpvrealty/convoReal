# Who added a listing to their inventory

On web and mobile, open Inventory and choose **Added to inventories** on a property card. The dialog or sheet lists each directly linked recipient's agent name, agency, copy creation date, and current import state.

- **In inventory:** an accepted copy exists, including listings later sold or taken off market.
- **Pending review:** the recipient has not accepted the shared listing yet.
- **Rejected / Archived / Agency archived:** retained records are visible without being presented as active imports.

Existing shared-link imports, direct account shares, and automatic source-agent copies use `source_property_id`, so they appear without a backfill. Link views or WhatsApp sends alone do not qualify. Independently entered listings, onward shares from another account's copy, and deleted copies are outside this view. The date is copy creation, not an approval timestamp; an automatic copy identifies the associated recipient agent rather than claiming they manually imported it.

`GET /api/properties/[id]/imports?page=1` serves both cookie and mobile bearer sessions. It first verifies the source property belongs to the caller's account using the authenticated client. Only then does a server-only lookup read direct recipient copies, with bounded pagination and profile lookups. It returns names and import state, without recipient phone numbers, internal notes, prices, or access to the recipient's property page. No database migration is required.

Validation includes route authorization and pagination tests, status tests, and the existing agent-inventory-sharing E2E flow: pending-to-accepted state, mobile bearer authentication, cross-account denial, and web dialogs at desktop and phone widths.
