// Shared by the auth Server Actions. It lives outside them because a
// "use server" module may only export async functions.
export type AuthState = { error: string } | null;
