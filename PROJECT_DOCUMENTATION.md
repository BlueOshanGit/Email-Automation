# Email-Automation Project Documentation

## Project Overview

**Project Name:** Email-Automation
**Type:** Node.js/Express Email Management & Automation System
**Purpose:** Automate email cloning, contact list segmentation, and email campaign management through HubSpot integration

---

## Table of Contents

1. [External APIs Used](#1-external-apis-used)
2. [What APIs Do In Our Project](#2-what-apis-do-in-our-project)
3. [Custom Functionality Code](#3-custom-functionality-code)
4. [Project Structure](#4-project-structure)
5. [Database Models](#5-database-models)
6. [Key Workflows](#6-key-workflows)

---

## 1. External APIs Used

### HubSpot API (Primary Integration)

| API Category | Base URL | Purpose |
|--------------|----------|---------|
| Marketing Emails API | `https://api.hubapi.com/marketing/v3/emails` | Clone, update, schedule, and publish emails |
| CRM Lists API | `https://api.hubapi.com/crm/v3/lists` | Create and manage contact lists |
| CRM Contacts API | `https://api.hubapi.com/crm/v3/objects/contacts` | Update contact properties |
| CRM Properties API | `https://api.hubapi.com/crm/v3/properties/contacts` | Fetch property options (brands) |

### MongoDB Atlas (Database)

| Service | Purpose |
|---------|---------|
| MongoDB Cloud Database | Store campaign configurations, cloned email records, list metadata, login activity |

---

## 2. What APIs Do In Our Project

### 2.1 HubSpot Marketing Emails API

#### Endpoints Used:

| Endpoint | Method | What It Does In Our Project |
|----------|--------|----------------------------|
| `/marketing/v3/emails` | GET | **Search emails by name** - Find existing emails to check for duplicates before cloning |
| `/marketing/v3/emails/{emailId}` | GET | **Get email details** - Fetch email properties like name, subject, content, custom properties (emailCategory, mdlzBrand) |
| `/marketing/v3/emails/clone` | POST | **Clone email template** - Create a copy of an existing email with a new name |
| `/marketing/v3/emails/{emailId}` | PATCH | **Update email draft** - Modify email properties like name, subject, scheduled time |
| `/marketing/v3/emails/{emailId}/draft` | PATCH | **Configure email recipients** - Set which lists receive the email and which are excluded |
| `/marketing/v3/emails/{emailId}/publish` | POST | **Publish/Schedule email** - Send email immediately or schedule for future delivery |
| `/marketing/v3/emails/{emailId}` | DELETE | **Delete email** - Remove unwanted cloned emails from HubSpot |

#### Simple Explanation:

```
┌─────────────────────────────────────────────────────────────────┐
│                    EMAIL CLONING FLOW                            │
├─────────────────────────────────────────────────────────────────┤
│  1. GET /emails/{id}     → Fetch original email details          │
│  2. POST /emails/clone   → Create a copy with new name           │
│  3. PATCH /emails/{id}   → Update the cloned email properties    │
│  4. PATCH /draft         → Set recipient lists (seed/exclusion)  │
│  5. POST /publish        → Schedule the email for sending        │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2.2 HubSpot CRM Lists API

#### Endpoints Used:

| Endpoint | Method | What It Does In Our Project |
|----------|--------|----------------------------|
| `/crm/v3/lists` | POST | **Create new list** - Create a new contact list for email campaign |
| `/crm/v3/lists` | GET | **Get all lists** - Fetch all available lists from HubSpot |
| `/crm/v3/lists/{listId}` | GET | **Get list details** - Fetch specific list information and member count |
| `/crm/v3/lists/{listId}` | DELETE | **Delete list** - Remove list from HubSpot during cleanup |
| `/crm/v3/lists/search` | POST | **Search lists** - Find lists by ID or criteria |
| `/crm/v3/lists/{listId}/memberships` | GET | **Get list members** - Fetch all contacts in a list |
| `/crm/v3/lists/{listId}/memberships/add` | PUT | **Add contacts to list** - Add selected contacts to the newly created list |

#### Simple Explanation:

```
┌─────────────────────────────────────────────────────────────────┐
│                  LIST CREATION FLOW                              │
├─────────────────────────────────────────────────────────────────┤
│  1. GET /memberships     → Get contacts from source list         │
│  2. POST /lists          → Create new campaign list              │
│  3. PUT /memberships/add → Add filtered contacts to new list     │
└─────────────────────────────────────────────────────────────────┘
```

---

### 2.3 HubSpot CRM Contacts API

#### Endpoints Used:

| Endpoint | Method | What It Does In Our Project |
|----------|--------|----------------------------|
| `/crm/v3/objects/contacts/batch/update` | POST | **Batch update contacts** - Update properties like `last_marketing_email_sent_brand` for all contacts in a list |

#### Simple Explanation:

```
When contacts are added to a campaign list, we update their properties:
- last_marketing_email_sent_brand → Track which brand sent them email
- Send date tracking → Know when last email was sent
```

---

### 2.4 HubSpot Properties API

#### Endpoints Used:

| Endpoint | Method | What It Does In Our Project |
|----------|--------|----------------------------|
| `/crm/v3/properties/contacts/mdlzBrand` | GET | **Get brand options** - Fetch all available brand values for dropdown menus |

---

## 3. Custom Functionality Code

### What We Built (Not Using APIs)

| Feature | Location | Description |
|---------|----------|-------------|
| **User Authentication** | `routes/auth.js`, `service/authService.js` | Login/logout with email domain validation (@blueoshan.com) |
| **Session Management** | `app.js` | Express session for keeping users logged in |
| **Campaign Configuration CRUD** | `routes/adminRoutes.js` | Create, read, update, delete segmentation campaigns |
| **Database Operations** | `service/database.js` | MongoDB connection and operations |
| **Login Tracking & Security** | `service/loginTracking.js` | Track login attempts, detect suspicious activity |
| **Data Retention Cleanup** | `service/dataRetention.js` | Automatic 31-day cleanup of old records |
| **Email Cloning Strategy** | `routes/cloner.js` | Smart scheduling algorithms (morning/afternoon/custom) |
| **Batch Processing Logic** | `routes/hubspotRoute.js` | Process campaigns with delays, handle retries |
| **Contact Deduplication** | `routes/hubspotRoute.js` | Track used contacts across campaigns |
| **UI/Dashboard** | `views/` | Handlebars templates for web interface |
| **Drag-Drop Reordering** | `routes/adminRoutes.js` | Reorder campaigns by priority |

---

### 3.1 Authentication System (Custom Code)

**Files:** `routes/auth.js`, `service/authService.js`

```
What It Does:
├── Validates email must end with @blueoshan.com
├── Validates password (currently hardcoded: 54321)
├── Creates user session on successful login
├── Destroys session on logout
└── Middleware to protect routes (ensureAuthenticated)
```

---

### 3.2 Login Tracking System (Custom Code)

**File:** `service/loginTracking.js`

```
What It Does:
├── Logs every login attempt with:
│   ├── Email address
│   ├── IP address
│   ├── Browser/user agent
│   ├── Timestamp
│   └── Success/failure status
│
├── Provides analytics:
│   ├── Login history for each user
│   ├── Success/failure statistics
│   └── All activity for admins
│
└── Security detection:
    ├── Multiple failed attempts (3+ in 15 min)
    ├── Multiple IPs (2+ in 15 min)
    └── Rapid attempts (5+ in 15 min)
```

---

### 3.3 Data Retention System (Custom Code)

**File:** `service/dataRetention.js`

```
What It Does:
├── Automatically runs cleanup at 2 AM daily
├── Deletes records older than 31 days:
│   ├── Cloned email records
│   └── Created list records
├── Can be triggered manually via API
└── Keeps database lean
```

---

### 3.4 Email Cloning Strategy Logic (Custom Code)

**File:** `routes/cloner.js`

```
Cloning Strategies Built:
│
├── SMART Strategy
│   └── Distributes emails across 12 morning slots (11 AM - 12 PM)
│       then continues with afternoon slots
│
├── MORNING Strategy
│   └── Starts at 11:00 AM, 5-minute intervals
│
├── AFTERNOON Strategy
│   └── Starts at 4:00 PM, 5-minute intervals
│
└── CUSTOM Strategy
    └── User-defined start time and intervals
```

**Schedule Generation Logic:**
```javascript
// Example: Smart strategy generates times like:
// 11:00 AM, 11:05 AM, 11:10 AM... (morning)
// 4:00 PM, 4:05 PM, 4:10 PM... (afternoon)
```

---

### 3.5 Campaign Processing with Delays (Custom Code)

**File:** `routes/hubspotRoute.js`

```
What It Does:
├── Processes campaigns sequentially
├── Adds 3-minute delay between campaigns
│   (to avoid HubSpot rate limits)
├── Tracks used contacts to prevent duplicates
├── Handles partial fulfillment:
│   ├── Primary list → Get contacts
│   ├── Not enough? → Try secondary list
│   └── Still not enough? → Report actual count
└── Updates contact properties after adding to list
```

---

### 3.6 Batch Operations with Retry (Custom Code)

**Files:** `routes/cloner.js`, `routes/hubspotRoute.js`

```
Retry Logic:
├── Maximum 3 retry attempts
├── Exponential backoff (200ms → 400ms → 800ms)
├── Progressive batch sizes for contact addition:
│   ├── Try 300 contacts at once
│   ├── If fails, try 100
│   ├── If fails, try 50
│   └── If fails, add one by one
└── Fallback verification (check if created despite error)
```

---

### 3.7 Database Models (Custom Code)

**Directory:** `models/`

| Model | Purpose |
|-------|---------|
| `Segmentation` | Store campaign configurations (brand, count, lists, dates) |
| `CreatedList` | Track lists created in HubSpot with metadata |
| `ClonedEmail` | Track cloned emails with scheduling info |
| `LoginActivity` | Store login attempts for security |
| `OperationStatus` | Track long-running operation progress |

---

## 4. Project Structure

```
Email-Automation/
│
├── app.js                      # Main application entry point
├── package.json                # Dependencies
├── .env                        # Environment variables (secrets)
│
├── routes/
│   ├── auth.js                 # Login/logout routes
│   ├── adminRoutes.js          # Dashboard & CRUD operations
│   ├── hubspotRoute.js         # List creation & management
│   ├── cloner.js               # Email cloning functionality
│   └── loginTracking.js        # Login activity API
│
├── service/
│   ├── database.js             # MongoDB connection
│   ├── authService.js          # Email validation
│   ├── loginTracking.js        # Login tracking service
│   └── dataRetention.js        # Auto-cleanup service
│
├── models/
│   ├── segmentation.js         # Campaign configuration schema
│   ├── list.js                 # Created lists schema
│   ├── clonedEmail.js          # Cloned emails schema
│   ├── loginActivity.js        # Login activity schema
│   └── operationStatus.js      # Operation tracking schema
│
├── views/                      # Handlebars UI templates
└── public/                     # Static assets (CSS, JS, images)
```

---

## 5. Database Models

### 5.1 Segmentation (Campaign Config)

```javascript
{
  campaign: "Summer Sale",        // Campaign name
  brand: "Oreo",                  // Brand name
  count: 5000,                    // Target contacts
  primaryListId: 12345,           // Main source list
  secondaryListId: 67890,         // Backup source list
  sendContactListId: 11111,       // Destination list
  domain: "example.com",          // Email domain
  date: "2025-01-15",             // Send date
  order: 1                        // Priority order
}
```

### 5.2 CreatedList (List Tracking)

```javascript
{
  name: "Oreo_Summer_Campaign_Jan15",
  listId: 99999,                  // HubSpot ILS ID
  legacyListId: 88888,            // HubSpot Legacy ID
  contactCount: 4850,             // Actual contacts added
  requestedCount: 5000,           // Requested count
  fulfillmentPercentage: 97       // 4850/5000 = 97%
}
```

### 5.3 ClonedEmail (Email Tracking)

```javascript
{
  originalEmailId: "12345",
  clonedEmailId: "67890",
  clonedEmailName: "Oreo_Newsletter_Jan15_1100",
  scheduledTime: "2025-01-15T11:00:00Z",
  status: "scheduled",            // scheduled/sent/failed
  cloningStrategy: "smart"        // smart/morning/afternoon/custom
}
```

---

## 6. Key Workflows

### 6.1 Email Cloning Workflow

```
User Request: "Clone email 12345, create 5 copies"
                    │
                    ▼
┌─────────────────────────────────────┐
│  1. CUSTOM CODE: Check duplicates   │
│     - Query MongoDB for existing    │
│     - Query HubSpot for existing    │
└─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│  2. API CALL: Get original email    │
│     GET /marketing/v3/emails/{id}   │
└─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│  3. CUSTOM CODE: Generate names     │
│     "Oreo_Newsletter_Jan15_1100"    │
│     "Oreo_Newsletter_Jan15_1105"    │
└─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│  4. API CALL: Clone each email      │
│     POST /marketing/v3/emails/clone │
└─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│  5. API CALL: Update draft          │
│     PATCH /emails/{id}/draft        │
│     - Add Seed list (39067)         │
│     - Add Exclusion list (10469)    │
└─────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│  6. CUSTOM CODE: Save to MongoDB    │
│     Store cloning record            │
└─────────────────────────────────────┘
                    │
                    ▼
               COMPLETE
```

---

### 6.2 List Creation Workflow

```
User Request: "Create lists for today's campaigns"
                    │
                    ▼
┌─────────────────────────────────────┐
│  1. CUSTOM CODE: Get campaigns      │
│     Query MongoDB for today's       │
│     segmentations                   │
└─────────────────────────────────────┘
                    │
                    ▼
    ┌───────── FOR EACH CAMPAIGN ─────────┐
    │                                      │
    │   ┌─────────────────────────────┐   │
    │   │ 2. API CALL: Get contacts   │   │
    │   │    GET /lists/{id}/members  │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    │                ▼                     │
    │   ┌─────────────────────────────┐   │
    │   │ 3. CUSTOM CODE: Filter      │   │
    │   │    Remove already-used      │   │
    │   │    contacts                 │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    │                ▼                     │
    │   ┌─────────────────────────────┐   │
    │   │ 4. API CALL: Create list    │   │
    │   │    POST /crm/v3/lists       │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    │                ▼                     │
    │   ┌─────────────────────────────┐   │
    │   │ 5. API CALL: Add contacts   │   │
    │   │    PUT /memberships/add     │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    │                ▼                     │
    │   ┌─────────────────────────────┐   │
    │   │ 6. API CALL: Update props   │   │
    │   │    POST /contacts/batch     │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    │                ▼                     │
    │   ┌─────────────────────────────┐   │
    │   │ 7. CUSTOM CODE: Save list   │   │
    │   │    Store in MongoDB         │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    │                ▼                     │
    │   ┌─────────────────────────────┐   │
    │   │ 8. CUSTOM CODE: Wait 3 min  │   │
    │   │    Rate limit delay         │   │
    │   └─────────────────────────────┘   │
    │                │                     │
    └────────────────┴─────── NEXT ────────┘
                    │
                    ▼
               COMPLETE
```

---

## Summary: API vs Custom Code

| Category | API-Based | Custom Code |
|----------|-----------|-------------|
| **Email Operations** | Clone, Update, Delete, Publish emails | Scheduling strategy, duplicate checking, batch processing |
| **List Operations** | Create, Delete, Add members | Campaign filtering, contact deduplication, retry logic |
| **Contact Operations** | Batch update properties | Property value selection, batch sizing |
| **Authentication** | - | Full login/logout system |
| **Data Storage** | - | MongoDB operations, models, queries |
| **Security** | - | Login tracking, suspicious activity detection |
| **Maintenance** | - | Auto-cleanup, data retention |
| **UI** | - | All dashboard and forms |

---

## Configuration

### Required Environment Variables

```
PORT=8020
MONGODB_URI=mongodb+srv://[credentials]
HUBSPOT_ACCESS_TOKEN=pat-na1-xxxxx
HUBSPOT_PORTAL_ID=5686032
SESSION_SECRET=xxxxx
```

### Hardcoded Values

```javascript
SEED_LIST_ID = 39067           // Recipients list
EXCLUSION_LIST_ID = 10469      // Suppression list
RETENTION_DAYS = 31            // Data cleanup after 31 days
CLEANUP_HOUR = 2               // Run cleanup at 2 AM
INTER_LIST_DELAY = 3 minutes   // Delay between campaigns
```

---

## 7. HubSpot Approval-Based Publish System

### The Problem

We needed to ensure that **only HubSpot-approved emails can be published** from our app. HubSpot has a built-in "Approval Status" system (`hs_approval_publish_status_v2`) but this property is **NOT available through any public HubSpot API** (V2, V3, V4, CRM Objects — none of them expose it).

### The Solution — Browser Interception Approach

We discovered that when HubSpot's own web UI loads the email list, it makes an **internal API call** to fetch approval data. We intercepted this call using Browser DevTools and replicated it in our backend using session cookies.

---

### How It Works (Step by Step)

#### STEP 1: User Clicks "Publish" in Our App

```
Frontend (emailPublisher.hbs)
    |
    |  POST /api/publish-email  { emailId: "209913582717" }
    |
    v
Backend (routes/cloner.js)
```

#### STEP 2: Backend Gets CRM Object ID

HubSpot has **two ID systems**:
- **Content ID** (Marketing Email ID) — e.g., `209913582717` (what we use)
- **CRM Object ID** — e.g., `542497872949` (what the internal API needs)

```
Our App  ──>  GET https://api.hubapi.com/cosemail/v1/emails/{emailId}
              (uses PAT token - public API)

Response: { crmObjectId: 542497872949, name: "...", ... }
```

**For DRAFT emails** that don't have a `crmObjectId` yet, we use a fallback — search by `hs_origin_asset_id` (explained in Step 3).

#### STEP 3: Backend Checks Approval Status via Internal CRM Search

This is the key part. We call HubSpot's **internal** CRM search API (the same one their web UI uses):

```
Our App  ──>  POST https://app.hubspot.com/api/crm-search/search?portalId=5686032

              Authentication: Session Cookie + CSRF Token (NOT PAT token)

              Body: {
                objectTypeId: "0-29",           // Marketing Email object type
                filterGroups: [{
                  filters: [{
                    operator: "EQ",
                    property: "hs_object_id",    // or "hs_origin_asset_id" for drafts
                    value: "542497872949"
                  }]
                }],
                properties: ["hs_approval_publish_status_v2", "hs_name", "hs_state"]
              }

Response: {
  results: [{
    properties: {
      hs_approval_publish_status_v2: { value: "no_approval_requested" },
      hs_name: { value: "BT Survey - Biscuits - Test - 26 Mar 2026" }
    }
  }]
}
```

#### STEP 4: Decision — Publish or Block

```
Approval Status Value         →  Action
─────────────────────────────────────────────────
"approved"                    →  ALLOW publish (proceed to HubSpot publish API)
"pending"                     →  BLOCK (403: "Email is pending approval")
"no_approval_requested"       →  BLOCK (403: "No approval requested")
"SESSION_EXPIRED"             →  BLOCK (401: "Update session cookie")
null (unknown)                →  BLOCK (403: "Could not determine status")
```

#### STEP 5: If Approved → Publish via HubSpot V3 API

```
Our App  ──>  POST https://api.hubapi.com/marketing/v3/emails/{emailId}/publish
              (uses PAT token - public API)

              → Email goes live on HubSpot!
```

---

### Complete Publish Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        USER CLICKS PUBLISH                       │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 1: Get CRM Object ID                                      │
│  API: GET cosemail/v1/emails/{emailId}                           │
│  Auth: PAT Token (public API)                                    │
│                                                                  │
│  Found crmObjectId?                                              │
│    YES → search by hs_object_id                                  │
│    NO  → search by hs_origin_asset_id (fallback for drafts)      │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  STEP 2: Check Approval Status                                   │
│  API: POST app.hubspot.com/api/crm-search/search                 │
│  Auth: Session Cookie + CSRF Token (internal API)                │
│                                                                  │
│  Property: hs_approval_publish_status_v2                         │
└────────────────────────────────┬─────────────────────────────────┘
                                 │
                    ┌────────────┼────────────┐
                    │            │            │
                    ▼            ▼            ▼
              ┌──────────┐ ┌──────────┐ ┌──────────────────┐
              │ approved │ │ pending  │ │ no_approval_     │
              │          │ │          │ │ requested        │
              └────┬─────┘ └────┬─────┘ └────────┬─────────┘
                   │            │                 │
                   ▼            ▼                 ▼
              ┌──────────┐ ┌──────────────────────────────┐
              │ PUBLISH  │ │     BLOCKED (403 Error)      │
              │ via V3   │ │  "Please get approval first" │
              │ API      │ └──────────────────────────────┘
              └──────────┘
```

---

### Two API Systems Used

| What               | API Endpoint                                      | Auth Method     | Why                          |
|---------------------|---------------------------------------------------|-----------------|------------------------------|
| Get CRM Object ID  | `api.hubapi.com/cosemail/v1/emails/{id}`          | PAT Token       | Public API, maps email → CRM |
| Check Approval     | `app.hubspot.com/api/crm-search/search`           | Session Cookie  | Internal API only            |
| Publish Email      | `api.hubapi.com/marketing/v3/emails/{id}/publish` | PAT Token       | Public API, triggers send    |

---

### Why Session Cookie? (The Catch)

HubSpot's approval status property (`hs_approval_publish_status_v2`) exists in their CRM schema but is **deliberately hidden** from all public APIs:

- V3 Marketing Emails API → doesn't return it
- CRM Objects API → "MARKETING_EMAIL not supported"
- GraphQL API → requires internal scope (403)
- Approvals v2 API → internal only (401)

The ONLY way to read it is through HubSpot's **internal CRM search API** at `app.hubspot.com/api/crm-search/search`, which requires browser session cookies (the same cookies your browser uses when you're logged into HubSpot).

### How to Get/Update the Session Cookie

1. Log into **app.hubspot.com** in your browser
2. Open **DevTools → Network tab**
3. Filter by "crm-search"
4. Find the `search` request
5. From the request headers, copy:
   - `hubspotapi` cookie value → paste into `.env` as `HUBSPOT_SESSION_COOKIE`
   - `hubspotapi-csrf` cookie value → paste into `.env` as `HUBSPOT_CSRF_TOKEN`

**Important:** These cookies expire periodically. When they expire, the system returns a `SESSION_EXPIRED` error and you'll need to update them.

---

### The Dual-Strategy for Finding Emails in CRM

HubSpot assigns CRM Object IDs differently based on email state:

| Email State | crmObjectId from cosemail API | How We Find It in CRM              |
|-------------|-------------------------------|-------------------------------------|
| PUBLISHED   | Available (e.g., 542449917529)| Filter by `hs_object_id`            |
| DRAFT       | `undefined` / not assigned    | Filter by `hs_origin_asset_id`      |

`hs_origin_asset_id` = the Marketing Email Content ID (the same ID we use throughout our app). This is always present in the CRM object, making it a reliable fallback.

When multiple CRM objects match (e.g., an email was cloned), we prefer the **DRAFT** one since that's the one about to be published.

---

### Files Modified for Approval System

| File                        | What Changed                                                    |
|-----------------------------|----------------------------------------------------------------|
| `routes/cloner.js`          | Added `checkHubSpotApprovalStatus()` function + approval gate in publish endpoint + `/check-approval/:emailId` GET endpoint |
| `views/emailPublisher.hbs`  | Enhanced error display for approval rejections (icons, colors)  |
| `models/clonedEmail.js`     | Removed old in-app approval fields (`isApproved`, `approvedBy`, `approvedAt`) |
| `.env`                      | Added `HUBSPOT_SESSION_COOKIE` and `HUBSPOT_CSRF_TOKEN`        |

---

### Environment Variables for Approval System

```env
# HubSpot Session Cookie for approval status check (internal API)
# Update this when the cookie expires by copying from browser DevTools
HUBSPOT_SESSION_COOKIE=AAccUfsUH2NfM1Hk...  (the hubspotapi cookie value)
HUBSPOT_CSRF_TOKEN=AAccUfsq7tyKfyrn...       (the hubspotapi-csrf cookie value)
```

---

