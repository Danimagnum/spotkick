export function errorDetails(error: unknown) {
    const name = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,79}$/.test(error.name) ? error.name : 'Error';
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string'
        && /^[A-Z][A-Z0-9_]{0,31}$|^\d{5}$/.test(error.code) ? error.code : undefined;
    return { error: name, code };
}
