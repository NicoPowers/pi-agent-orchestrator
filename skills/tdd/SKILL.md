# Test-Driven Development

Use this skill when the user asks you to write code that should be tested, implement a new feature, or fix a bug. Also use it when the user explicitly asks for tests.

## Steps

1. **Understand the requirement** — Ask clarifying questions if the expected behavior is ambiguous.
2. **Write the test first** — Create a failing test that describes the desired behavior. Use the project's existing test framework (Jest, pytest, Go test, etc.).
3. **Run the test to confirm it fails** — Show the failure. Explain why it fails.
4. **Write the minimum implementation** — Make the test pass with the simplest possible code. No premature abstraction.
5. **Run the test to confirm it passes** — Show the pass.
6. **Refactor if needed** — Clean up duplication, improve naming, but keep tests passing.
7. **Report coverage** — Tell the user what the tests cover and what edge cases you handled.

## Rules

- Never skip step 2. The test MUST be written before the implementation.
- If the project has no test framework, suggest one and set it up first.
- One test per behavior, not one test per function.
