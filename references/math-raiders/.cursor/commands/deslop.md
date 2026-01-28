# Remove AI code slop

Check the diff against main, and remove all AI generated slop introduced in this branch.

This includes:
- Verbose comments that a human wouldn't add or are inconsistent with the rest of the file (e.g., labeled patterns like "PATTERN:", "CRITICAL:", excessive explanations of obvious code)
- Extra defensive checks or try/catch blocks that are abnormal for that area of the codebase (especially if called by trusted / validated codepaths)
- Casts to any to get around type issues
- Any other style that is inconsistent with the file

**Keep**: Concise comments that explain non-trivial logic (e.g., "Refresh case: same raid but not subscribed yet", "Use server's authoritative start time (handles pause/resume)"). A junior engineer should understand why code exists, not just what it does.

Report at the end with only a 1-3 sentence summary of what you changed