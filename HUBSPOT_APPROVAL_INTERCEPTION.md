# HubSpot Approval Status Interception — How We Did It

## Why This File Exists

HubSpot has NO public API to read the email "Approval Status". We had to intercept the internal API call that HubSpot's own web UI makes. This document explains exactly how we discovered it, how it works, and how to maintain it.

---

## The Discovery Process

### What We Tried First (All Failed)

| API Tried | Endpoint | Result |
|-----------|----------|--------|
| V3 Marketing Emails | `GET /marketing/v3/emails/{id}` | Returns 39 fields — NO approval field |
| V2 Content API | `GET /content/api/v2/emails/{id}` | Returns 134 fields — NO approval field |
| V4 Content API | `GET /content/api/v4/emails/{id}` | Returns 130 fields — NO approval field |
| CosEmail API | `GET /cosemail/v1/emails/{id}` | Returns 134 fields — NO approval field |
| CRM Objects API | `GET /crm/v3/objects/0-29/{id}` | Error: "MARKETING_EMAIL not supported" |
| GraphQL API | `POST /collector/graphql` | 403: Requires internal scope |
| Approvals v2 API | `GET /approvals/v2/...` | 401: Internal only |

**Conclusion:** The property `hs_approval_publish_status_v2` exists in HubSpot's CRM schema but is deliberately hidden from ALL public APIs.

### How We Found the Working Approach

1. Opened HubSpot email list page in browser (where "Approval Status" column is visible)
2. Opened **Chrome DevTools → Network tab → Fetch/XHR filter**
3. Found that HubSpot UI calls: `POST app.hubspot.com/api/crm-search/search`
4. This internal API returns `hs_approval_publish_status_v2` for each email
5. We replicated this exact API call in our Node.js backend using the session cookies

---

## The Internal API — How It Works

### Endpoint

```
POST https://app.hubspot.com/api/crm-search/search?portalId=5686032&clienttimeout=14000
```

### Authentication (NOT PAT Token)

This API does NOT accept HubSpot's Personal Access Token. It requires **browser session cookies**:

```
Cookie: hubspotapi-csrf={CSRF_TOKEN}; csrf.app={CSRF_TOKEN}; hubspotapi={SESSION_COOKIE}
Header: x-hubspot-csrf-hubspotapi: {CSRF_TOKEN}
```

### Request Body

```json
{
  "count": 1,
  "offset": 0,
  "objectTypeId": "0-29",
  "requestOptions": {
    "allPropertiesFetchMode": "latest_version",
    "includeAllProperties": false
  },
  "filterGroups": [{
    "filters": [{
      "operator": "EQ",
      "property": "hs_object_id",
      "value": "542497872949"
    }]
  }],
  "properties": ["hs_approval_publish_status_v2", "hs_name", "hs_state"],
  "query": "",
  "sorts": [{ "property": "hs_createdate", "order": "DESC" }]
}
```

**Key fields:**
- `objectTypeId: "0-29"` → This is HubSpot's internal type ID for MARKETING_EMAIL
- `hs_approval_publish_status_v2` → The approval status property (v2 is the machine-readable version)
- `hs_object_id` → The CRM Object ID (not the marketing email content ID)

### Response

```json
{
  "total": 1,
  "results": [{
    "objectId": 542497872949,
    "properties": {
      "hs_approval_publish_status_v2": {
        "value": "no_approval_requested"
      },
      "hs_name": {
        "value": "BT Survey - Biscuits - Test - 26 Mar 2026"
      },
      "hs_state": {
        "value": "DRAFT"
      }
    }
  }]
}
```

### Possible Approval Status Values

| Value | Display Name | Meaning |
|-------|-------------|---------|
| `approved` | Approved | Email has been approved — CAN publish |
| `pending` | Pending | Email is waiting for approval — CANNOT publish |
| `no_approval_requested` | No Approval Requested | Email hasn't been submitted for approval — CANNOT publish |

---

## The ID Problem — Two Different ID Systems

HubSpot uses **two different IDs** for marketing emails:

| ID Type | Example | Where Used |
|---------|---------|------------|
| **Content ID** (Marketing Email ID) | `209913582717` | All public APIs, our app, HubSpot UI URL bar |
| **CRM Object ID** | `542497872949` | Internal CRM search API only |

### How We Map Between Them

**For Published/Sent emails:**
```
GET https://api.hubapi.com/cosemail/v1/emails/{contentId}
→ Response includes: { crmObjectId: 542497872949 }
→ Then search CRM by: hs_object_id = 542497872949
```

**For Draft emails (crmObjectId is undefined):**
```
Search CRM directly by: hs_origin_asset_id = 209913582717
→ hs_origin_asset_id equals the marketing email content ID
→ Works for drafts that haven't been assigned a CRM object ID yet
```

### Why Drafts Don't Have CRM Object IDs

When you clone an email in HubSpot, the CRM object is created but the `crmObjectId` field is NOT populated in the `cosemail/v1` API response until the email is published. However, the CRM object DOES exist and has `hs_origin_asset_id` set to the content ID.

---

## Our Implementation

### File: `routes/cloner.js`

#### Function: `checkHubSpotApprovalStatus(emailId)`

```
Input:  Marketing Email Content ID (e.g., "209913582717")
Output: "approved" | "pending" | "no_approval_requested" | "SESSION_EXPIRED" | null

Flow:
  1. Call cosemail/v1 API with PAT token → try to get crmObjectId
  2. If crmObjectId found → build filter: hs_object_id = crmObjectId
  3. If NOT found (draft) → build filter: hs_origin_asset_id = emailId
  4. Call internal CRM search API with session cookie
  5. If multiple results → prefer the DRAFT one
  6. Return the hs_approval_publish_status_v2 value
```

#### Integration in Publish Endpoint

```
POST /api/publish-email  { emailId }
  │
  ├── 1. Find email in our MongoDB
  │
  ├── 2. checkHubSpotApprovalStatus(emailId)
  │      │
  │      ├── "approved"              → Continue to step 3
  │      ├── "pending"               → Return 403 error
  │      ├── "no_approval_requested" → Return 403 error
  │      ├── "SESSION_EXPIRED"       → Return 401 error
  │      └── null                    → Return 403 error
  │
  ├── 3. Set schedule time (if provided)
  │      PATCH /marketing/v3/emails/{id}/draft
  │
  ├── 4. Publish email
  │      POST /marketing/v3/emails/{id}/publish
  │
  └── 5. Update MongoDB status → "published"
```

#### Standalone Check Endpoint

```
GET /api/check-approval/{emailId}
→ Returns: { success: true, approvalStatus: "approved" | "pending" | ... }
```

---

## Session Cookie Maintenance

### When Do Cookies Expire?

HubSpot session cookies expire periodically (usually after a few hours to days of inactivity). When expired, the API returns HTTP 401.

### How to Update

1. Open **app.hubspot.com** in your browser (make sure you're logged in)
2. Open **DevTools** (F12) → **Network tab**
3. Filter by **Fetch/XHR**
4. Navigate to **Marketing → Email** in HubSpot
5. Look for a request to `crm-search/search`
6. Click on it → go to **Headers** tab
7. In **Request Headers**, find the `Cookie` header
8. Copy these two values:
   - `hubspotapi=<LONG_VALUE>` → paste the value into `.env` as `HUBSPOT_SESSION_COOKIE`
   - `hubspotapi-csrf=<VALUE>` → paste the value into `.env` as `HUBSPOT_CSRF_TOKEN`
9. Restart the server

### .env Format

```env
HUBSPOT_SESSION_COOKIE=AAccUfsUH2NfM1Hk...  (the hubspotapi cookie value — very long string)
HUBSPOT_CSRF_TOKEN=AAccUfsq7tyKfyrn...       (the hubspotapi-csrf value — shorter string)
```

### What Happens When Cookie Expires?

- The publish endpoint returns: `401 - "HubSpot session cookie has expired. Please update..."`
- The frontend shows a key icon with the error message
- No emails can be published until the cookie is updated

---

## Frontend Error Handling

### File: `views/emailPublisher.hbs`

When publish is blocked due to approval status, the frontend shows:

| Status | Icon | Border Color | Message |
|--------|------|-------------|---------|
| `pending` | Hourglass | Yellow (#f39c12) | "Email is pending approval in HubSpot" |
| `no_approval_requested` | Shield | Red (#e74c3c) | "No approval has been requested" |
| `session_expired` | Key | Red (#e74c3c) | "HubSpot session cookie has expired" |

---

## Summary

```
                    PUBLIC APIs                        INTERNAL API
                    (PAT Token)                     (Session Cookie)
                         │                                │
    ┌────────────────────┤                                │
    │                    │                                │
    ▼                    ▼                                ▼
┌────────┐      ┌──────────────┐              ┌──────────────────┐
│cosemail│      │ V3 Marketing │              │   CRM Search     │
│  /v1   │      │   /publish   │              │   (Internal)     │
│        │      │              │              │                  │
│ Get    │      │ Actually     │              │ Check approval   │
│ CRM ID │      │ publish the  │              │ status property  │
│        │      │ email        │              │                  │
└───┬────┘      └──────┬───────┘              └────────┬─────────┘
    │                  │                               │
    │           Only called if                  Returns one of:
    │           status = "approved"             • approved
    │                                          • pending
    │                                          • no_approval_requested
    └──────── Maps Content ID ─────────────────► to CRM Object ID
              (209913582717)                     (542497872949)
```

This approach works because we're doing exactly what HubSpot's own web browser UI does — making the same internal API call with the same authentication. The trade-off is that session cookies expire and need manual renewal.
