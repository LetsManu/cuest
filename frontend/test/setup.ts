// Silence Lit's dev-mode notice in test output.
(globalThis as unknown as { litIssuedWarnings: Set<string> }).litIssuedWarnings = new Set(['dev-mode']);
