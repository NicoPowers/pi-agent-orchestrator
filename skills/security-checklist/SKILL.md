# Security Checklist

Use this skill when reviewing code that handles user input, authentication, data storage, network operations, or any code that touches sensitive data. Also use it when the user asks for a security review.

## Checklist

1. **Injection attacks** — Are all user inputs sanitized? Check for SQL injection, command injection, XSS, and path traversal.
2. **Authentication** — Are auth checks present on all sensitive endpoints? Are sessions/tokens handled correctly?
3. **Secrets management** — Are API keys, passwords, or tokens hardcoded in source? Are they logged or exposed in errors?
4. **Authorization** — Does the code verify the user has permission for the action? Is there any broken access control?
5. **Data exposure** — Is sensitive data returned in error messages, logs, or API responses?
6. **Dependencies** — Are there known vulnerabilities in imported libraries? Are dependencies pinned?
7. **Cryptography** — Is crypto used correctly? Are weak algorithms or modes used? Is randomness cryptographically secure?

## Output format

For each finding:
- **Severity**: Critical / High / Medium / Low
- **Location**: File path and line number
- **Issue**: What is wrong
- **Fix**: Concrete code suggestion or pattern to use

If no issues are found in a category, briefly state "No issues found" and move on. Do NOT skip categories.
