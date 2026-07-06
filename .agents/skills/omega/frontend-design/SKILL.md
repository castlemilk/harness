---
name: frontend-design
description: Frontend design and UI component implementation patterns.
---

When implementing or reviewing frontend UI:

1. Inspect existing components and design tokens before adding new styles.
2. Use semantic HTML, accessible labels, and focusable interactive elements.
3. Keep layouts responsive: avoid fixed widths/heights that break on small viewports.
4. Add meaningful hover/focus/active states and transitions for interactive elements.
5. Validate with the project's component tests and, if available, visual regression checks.
6. Prefer composition over boolean props; keep component APIs small and explicit.
