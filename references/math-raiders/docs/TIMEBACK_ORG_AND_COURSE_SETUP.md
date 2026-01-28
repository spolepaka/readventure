# Timeback Org & Course Setup

## Overview
This document captures the minimal prerequisites required before creating courses in the Timeback (Alpha 1EdTech) platform. It complements `TIMEBACK_INTEGRATION_CHECKLIST.md` and will evolve as workflows expand.

## 1. Obtain API Credentials
- Request a Timeback client ID and client secret from the platform administrator.
- Store them in the client `.env.local` file as:
  - `TIMEBACKCLIENTID`
  - `TIMEBACKSECRET`
- Use `bun scripts/timebackAuth.ts` to verify the credentials can fetch an access token:
  - `bun scripts/timebackAuth.ts`
  - Add `--raw` to print only the token if needed.

## 2. Confirm or Create an Organization
- Every course must reference an organization `sourcedId`.
- If an existing org should be reused, retrieve and validate its `sourcedId`.
- If no suitable org exists:
  1. Prepare an org payload containing name and type (`district`, `school`, etc.). Omit `sourcedId` to auto-generate.
  2. Run `bun scripts/createOrg.ts --payload='{"org":{"name":"Alpha District","type":"district"}}'`.
  3. The script will output the created org details and generated `sourcedId`.
  4. Record that `sourcedId` for subsequent course creation.

## 3. Create a Course
- Ensure the target org `sourcedId` is available (see step 2).
- Draft a course payload including `title`, `courseCode`, `grades`, `subjects`, and optional `metadata`.
- Run:
  - `bun scripts/createCourse.ts --payload='{"course":{"title":"Math Raiders - World History","courseCode":"MR-WH-PP100","grades":["09","10","11","12"],"subjects":["Social Studies"],"org":{"sourcedId":"<ORG_ID>"}}}'`
- The script auto-generates `sourcedId`, default `status: "active"`, and `dateLastModified` if omitted.
- Response is printed to the console, including the allocated course `sourcedId`.

### Course Payload Tips
- `metadata` can store goal/metric fields like daily XP targets.
- `resources` can remain an empty array during initial setup; add `component-resource` links later.
- If syncing with Math Academy conventions, mirror their metadata structure (see example payloads).

## 4. Create Course Components
- Use `scripts/createCourseComponent.ts` to add units/modules/topics to the course.
- Payload must include `title`, `course` (with `sourcedId`), and optional `parent`/`sortOrder`.
- Example:
  ```
  bun scripts/createCourseComponent.ts --payload='{"courseComponent":{"title":"Unit 1 - Foundations","sortOrder":1,"course":{"sourcedId":"fe15be0a-9f8d-4251-b000-402c6581617f"},"parent":null,"prerequisites":[],"prerequisiteCriteria":"ALL"}}'
  ```
- The script auto-generates `sourcedId`, defaults status/date, and prints API response.

## 5. Link Resources to Components
- Use `scripts/createComponentResource.ts` to attach a resource to a specific course component.
- Requires the component `sourcedId` and resource `sourcedId` from earlier steps.
- Example:
  ```
  bun scripts/createComponentResource.ts --payload='{"componentResource":{"title":"Math Raid Launch","sortOrder":1,"courseComponent":{"sourcedId":"<COMPONENT_ID>"},"resource":{"sourcedId":"<RESOURCE_ID>"}}}'
  ```
- The script auto-generates the link `sourcedId`, defaults status/date, and prints the API response.

## Next Updates
- Add step-by-step examples for creating courses and resources once org setup is confirmed.
- Document error-handling patterns and response codes after first integration run.
- Link back to this doc from the integration checklist phase references.
