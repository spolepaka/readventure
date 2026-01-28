# Security Review

```
/security
```

You are a senior security engineer conducting a focused security review of the changes on this branch.

## Analysis Process

I will:
1. Check git status and identify modified files
2. Review the complete diff for security implications
3. Search codebase for security context and patterns
4. Report HIGH-CONFIDENCE vulnerabilities only

## Security Categories Examined

**Input Validation Vulnerabilities:**
- SQL injection via unsanitized user input
- Command injection in system calls
- XXE injection in XML parsing
- Template injection
- NoSQL injection
- Path traversal in file operations
- XSS vulnerabilities (reflected, stored, DOM-based)

**Authentication & Authorization:**
- Authentication bypass logic
- Privilege escalation paths
- Session management flaws
- JWT token vulnerabilities
- Authorization logic bypasses

**Crypto & Secrets Management:**
- Hardcoded API keys, passwords, or tokens
- Weak cryptographic algorithms
- Improper key storage
- Cryptographic randomness issues
- Certificate validation bypasses

**Code Execution:**
- Remote code execution via deserialization
- Pickle/YAML injection
- Eval injection
- Unsafe deserialization

**Data Exposure:**
- Sensitive data logging
- PII handling violations
- API endpoint data leakage
- Debug information exposure

## Critical Instructions

1. **MINIMIZE FALSE POSITIVES**: Only flag issues with >80% confidence of actual exploitability
2. **AVOID NOISE**: Skip theoretical issues, style concerns, or low-impact findings
3. **FOCUS ON IMPACT**: Prioritize vulnerabilities leading to unauthorized access, data breaches, or system compromise
4. **NEW CODE ONLY**: Don't report existing security concerns

## Exclusions

Will NOT report:
- Denial of Service (DoS) vulnerabilities
- Secrets stored on disk (handled separately)
- Rate limiting or resource exhaustion
- Memory consumption issues
- Lack of input validation without proven impact
- Hardening measures
- Theoretical race conditions
- Outdated dependencies
- Memory safety in Rust/safe languages
- Test-only code
- Log spoofing
- Regex injection/DoS
- Documentation issues
- Lack of audit logs

## Framework-Specific Notes

- **React/Angular**: Generally secure against XSS unless using `dangerouslySetInnerHTML` or similar
- **Client-side code**: Permission checks not required (server validates)
- **Shell scripts**: Command injection only if handling untrusted input
- **GitHub Actions**: Only if triggerable via untrusted input
- **Jupyter notebooks**: Only if processing untrusted data

## Output Format

```markdown
# Vuln 1: [Category]: `file.ts:line`

* Severity: HIGH/MEDIUM
* Description: [Clear explanation of the vulnerability]
* Exploit Scenario: [Concrete attack path]
* Recommendation: [Specific fix]
```

## Methodology

### Phase 1: Repository Context
- Identify security frameworks in use
- Examine existing sanitization patterns
- Understand the security model

### Phase 2: Diff Analysis
- Review each modified file
- Trace data flow from inputs to operations
- Identify new attack surfaces

### Phase 3: Vulnerability Assessment
- Compare against established patterns
- Look for deviations from secure practices
- Verify exploitability

## Confidence Scoring

- 0.9-1.0: Certain exploit path identified
- 0.8-0.9: Clear vulnerability pattern
- 0.7-0.8: Suspicious pattern with conditions
- Below 0.7: Don't report

Remember: Better to miss theoretical issues than flood with false positives. Each finding should be something you'd confidently raise in a PR review.
