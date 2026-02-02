# Development Ground Rules

## Code Quality

1. **Modular Code**: Each module has a single responsibility with a simple, well-defined interface
2. **No Side Effects**: Functions are pure where possible - same inputs always produce same outputs
3. **Easily Replaceable**: Components can be swapped without affecting others (e.g., swap Postgres adapter for MySQL)
4. **Testable Units**: Each function/class can be tested in isolation without mocking the world

## Testing

5. **Unit Test Scope**: Each test tests ONE thing - no integration tests masquerading as unit tests

## Workflow

6. We use GitHub issues: read issue details to understand the scope of work. If, in the course of doing work, we identify another bug, potential feature, or work outside the scope of the work at hand, create a new issue for it, clearly outlining the work to be done.
7. **Small Commits**: Work in small chunks, commit after each stage. Build and tests should pass before each commit. Commit messages are short, single-line descriptions - the diff speaks for itself
