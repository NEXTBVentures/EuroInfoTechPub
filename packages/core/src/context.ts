export type Actor =
  | { kind: "anonymous" }
  | { kind: "user"; userId: string };

export interface RequestContext {
  organizationId: string;
  actor: Actor;
  requestId: string;
  vendorId?: string;
}

export interface AuthorizationPolicy {
  can(context: RequestContext, permission: string): Promise<boolean>;
}

export const denyByDefaultAuthorization: AuthorizationPolicy = {
  async can() {
    return false;
  },
};

export function assertOrganizationScope(
  context: RequestContext,
  resourceOrganizationId: string,
): void {
  if (!context.organizationId || context.organizationId !== resourceOrganizationId) {
    throw new Error("organization_scope_violation");
  }
}
