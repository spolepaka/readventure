# Timeback API Integration Checklist

## Purpose
- Capture the authoritative, end-to-end workflow for integrating Math Raiders with the Timeback (Alpha 1EdTech) platform.
- Keep this checklist updated as we learn more, especially when Caliper events work begins.
- Provide quick-win steps that a teammate can execute without additional context.

---

## Phase 0 – Prep & Credentials
- [ ] Confirm we have valid API credentials for Alpha 1EdTech (client id/secret or token).
- [ ] Verify base URL `https://api.alpha-1edtech.com` is reachable from current network/VPN.
- [ ] Gather course metadata from curriculum owners (course title, code, grades, subject, org ids).
- [ ] Decide on naming convention for `sourcedId` values (e.g., kebab-case course codes).
- [ ] Review existing Math Academy course configuration as the template for structure and naming.
- [ ] Identify target org hierarchy (district/school) or reuse existing ones if available.
- [ ] Reference `TIMEBACK_ORG_AND_COURSE_SETUP.md` for detailed prerequisites before proceeding.

## Phase 0.5 – Org Creation (New)
- [ ] If a new org is required, construct payload with `sourcedId`, name, type, and optional parent.
- [ ] Run `bun scripts/createOrg.ts --payload='{"org":{...}}'` to create the org via OneRoster API.
- [ ] Log returned org `sourcedId` for course linkage.
- [ ] Handle conflict scenarios (existing org) by documenting merge/update strategy.

## Phase 1 – Course Definition (OneRoster v1.2)
- [ ] Draft course payload JSON with status, title, code, grades, subjects, subject codes, org, and level.
- [ ] Confirm payload conforms to OneRoster v1.2 schema (no extra fields, correct casing).
- [ ] Send `POST /ims/oneroster/rostering/v1p2/courses` to create the course (e.g., `1273-ap-world-history-modern-pp100`).
- [ ] Capture response `sourcedId` and store in project secrets vault for reuse.
- [ ] If the course already exists, document handling strategy (update vs. skip).

## Phase 2 – Unit Components
- [ ] Outline unit list with titles, sort order, `dateLastModified`, and parent hierarchy (top-level units have `parent = null`).
- [ ] For each unit, build JSON payload for `POST /ims/oneroster/rostering/v1p2/courses/components` referencing `courseSourcedId` and course sourcedId.
- [ ] Execute POST requests per unit, verifying HTTP 201 responses and capturing returned IDs.
- [ ] Record mapping of unit titles → sourcedIds for downstream topic creation.

## Phase 3 – Topic Subcomponents
- [ ] For each unit, enumerate topics/lessons with desired order and metadata.
- [ ] Prepare topic payload referencing parent unit via `{ "sourcedId": "unit-#-id" }`.
- [ ] POST each topic to `/ims/oneroster/rostering/v1p2/courses/components`, confirming creation.
- [ ] Log topic sourcedIds and ensure no duplicate sort orders within a parent.

## Phase 4 – Course Resources & Launch Configuration
- [ ] Mirror the Math Academy setup: create a single component-resource/resource path to verify integration.
- [ ] Add resource payload with type `interactive`, launch URL, vendorId, vendor name, and Timeback-required metadata (see internal doc).
- [ ] Link the resource to the appropriate component via component-resource creation.
- [ ] Validate resource visibility within Timeback UI matches expectations.
- [ ] Reference: https://docs.google.com/document/d/1pqo0D2hpozv-OYom_-hRotLIm85S8vny2o1tUMh3wpU/edit?tab=t.x2y6cux6ih2b#heading=h.s99bghx0zl0h.

## Phase 5 – Validation & QA
- [ ] Retrieve course via `GET /ims/oneroster/rostering/v1p2/courses/{sourcedId}` to validate saved data.
- [ ] Retrieve components via `GET /ims/oneroster/rostering/v1p2/courses/{courseId}/components` to confirm hierarchy.
- [ ] Retrieve resources/components to ensure launch data is persisted.
- [ ] Document any discrepancies and resolutions.
- [ ] Align course structure with internal curriculum documentation for sign-off.

## Phase 6 – Next Steps (Placeholder)
- [ ] Define automation scripts under `scripts/` directory (planned).
- [ ] Prepare to document Caliper event creation once requirements arrive.
- [ ] Identify data sources needed for XP attribution through Timeback API.
- [ ] Confirm student-facing activity feed expectations; plan Caliper payloads accordingly.
- [ ] Document script usage (`scripts/timebackAuth.ts`, `scripts/createOrg.ts`) for future automation.

---

### Authentication Notes
- [ ] Validate access via shared AWS Cognito auth flow (same as existing Math Academy usage).
- [ ] Confirm automatic authentication works end-to-end; report issues back to Amanda/Timeback team.

### Open Questions
- Are we sending Caliper events to Timeback? Capture decision + owner.
- Is this integration serving as a Fast Math replacement, or another use case? Document product rationale.

---

### Reference Payloads
```
POST /ims/oneroster/rostering/v1p2/courses
{
  "course": {
    "sourcedId": "1273-ap-world-history-modern-pp100",
    "status": "active",
    "title": "1273 AP World History: Modern - PP100",
    "courseCode": "APWHM-PP100",
    "grades": ["09", "10", "11", "12"],
    "subjects": ["Social Studies"],
    "subjectCodes": [],
    "org": { "sourcedId": "alpha-learn-123" },
    "level": "AP"
  }
}
```

```
POST /ims/oneroster/rostering/v1p2/courses/components
{
  "courseComponent": {
    "sourcedId": "unit-1-id",
    "status": "active",
    "dateLastModified": "2024-03-04T20:00:00.000Z",
    "title": "1. The Global Tapestry c. 1200 to c. 1450",
    "sortOrder": 1,
    "courseSourcedId": "1273-ap-world-history-modern-pp100",
    "course": { "sourcedId": "1273-ap-world-history-modern-pp100" },
    "parent": null,
    "prerequisites": [],
    "prerequisiteCriteria": "ALL",
    "unlockDate": null
  }
}
```

```
POST /ims/oneroster/rostering/v1p2/courses/components
{
  "courseComponent": {
    "sourcedId": "unit-1-topic-1-id",
    "status": "active",
    "dateLastModified": "2024-03-04T20:00:00.000Z",
    "title": "1. Organizer - Unit 1",
    "sortOrder": 1,
    "courseSourcedId": "1273-ap-world-history-modern-pp100",
    "course": { "sourcedId": "1273-ap-world-history-modern-pp100" },
    "parent": { "sourcedId": "unit-1-id" },
    "prerequisites": [],
    "prerequisiteCriteria": "ALL",
    "unlockDate": null,
    "metadata": {}
  }
}
```

---

### Testing Notes
- No API calls attempted yet.
- Update this section with command snippets, HTTP status codes, and troubleshooting outcomes during execution.
- Capture sample outputs from `createOrg` and auth helper once executed.

### Issues & Retrospective
- _No issues logged yet._

