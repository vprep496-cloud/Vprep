import type { User } from "../types";

export type CandidateUser = User & { role: "candidate" };

export const MOBILE_ROLE_BLOCK_MESSAGE =
  "V-Prep Mobile is for candidate accounts. Admin and superadmin users should sign in from the Admin Portal.";

export class MobileRoleAccessError extends Error {
  constructor(readonly role: User["role"]) {
    super(MOBILE_ROLE_BLOCK_MESSAGE);
    this.name = "MobileRoleAccessError";
  }
}

export function isCandidateUser(user: User | null | undefined): user is CandidateUser {
  return user?.role === "candidate";
}

export function ensureMobileCandidate(user: User): CandidateUser {
  if (!isCandidateUser(user)) {
    throw new MobileRoleAccessError(user.role);
  }
  return user;
}

export function isMobileRoleAccessError(error: unknown): error is MobileRoleAccessError {
  return error instanceof MobileRoleAccessError;
}
