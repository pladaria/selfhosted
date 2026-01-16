# Project Coding Standards

## Language and Style

All code, comments, and documentation must be written in English with a professional tone.

### Code

- Variable names, function names, class names: English only
- Code comments: English only
- Error messages and logs: English only

### Documentation

- README files: English only
- API documentation: English only
- Inline documentation: English only

### Style

- Professional and technical tone
- No emojis in code or documentation
- Clear, concise, and precise language

## Code Conventions

### TypeScript/JavaScript

- Use TypeScript for frontend code
- Modern ES6+ syntax
- Prefer `const` over `let`, avoid `var`
- Use async/await over raw promises
- Descriptive variable and function names

### Comments

- Explain "why" not "what" when possible
- Keep comments synchronized with code
- Use JSDoc for function documentation

### Example

```typescript
// Calculate total price including tax
function calculateTotalPrice(basePrice: number, taxRate: number): number {
    return basePrice * (1 + taxRate);
}
```

## Git Commits

- Commit messages in English
- Use conventional commits format when applicable
- Be descriptive but concise
