import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActorType, RoleName } from '@prisma/client';
import { AuditLogService } from '../../../core/audit/audit-log.service';
import { TenantResourceNotFoundException } from '../../../core/guards/rbac.exceptions';
import { PrismaService } from '../../../database/prisma.service';
import {
  AccessTokenPayload,
  TokenService,
} from '../../auth/application/token.service';
import { NotificationsService } from '../../notifications/application/notifications.service';
import { TenantInvitationEntity } from '../domain/entities/tenant-invitation.entity';
import {
  TENANT_INVITATION_REPOSITORY,
  type TenantInvitationRepositoryPort,
} from '../domain/ports/tenant-invitation-repository.port';
import {
  InvalidOrExpiredInvitationException,
  InvitationAlreadyPendingException,
} from './exceptions/tenant.exceptions';

export interface CreateInvitationInput {
  email: string;
  role: typeof RoleName.MANAGER | typeof RoleName.STAFF;
}

/** What `AuthService.acceptInvitation` needs to create the invited `User` — deliberately not the full entity. */
export interface ConsumedInvitation {
  invitationId: string;
  tenantId: string;
  email: string;
  roleId: string;
  roleName: RoleName;
}

/**
 * `POST/GET /tenant/invitations`, `DELETE /tenant/invitations/:id`
 * (deliberately kept under `/tenant/invitations` rather than
 * API_SPECIFICATION.md's originally-implied `/users` path — see
 * docs/adr/ADR-006: `TenantInvitation` is genuinely tenant-owned data, and
 * a full `Users` staff-CRUD module isn't this milestone's scope).
 *
 * Also the cross-module surface `AuthModule` calls for
 * `POST /auth/accept-invitation` (`validateAndConsume`/`markAccepted`) —
 * exactly the "cross-module communication through each module's public
 * application service" pattern SYSTEM_ARCHITECTURE.md Section 2.4 requires.
 */
@Injectable()
export class TenantInvitationService {
  constructor(
    @Inject(TENANT_INVITATION_REPOSITORY)
    private readonly invitations: TenantInvitationRepositoryPort,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly notifications: NotificationsService,
    private readonly auditLog: AuditLogService,
    private readonly configService: ConfigService,
  ) {}

  async createInvitation(
    tenantId: string,
    actor: AccessTokenPayload,
    input: CreateInvitationInput,
  ): Promise<TenantInvitationEntity> {
    const email = input.email.trim().toLowerCase();

    const existingPending = await this.invitations.findPendingByTenantAndEmail(
      tenantId,
      email,
    );
    if (existingPending) {
      throw new InvitationAlreadyPendingException();
    }

    const role = await this.prisma.role.findUnique({
      where: { name: input.role },
    });
    if (!role) {
      // Seeded reference data — its absence is a configuration error, not a
      // user-facing validation failure (same convention as
      // PrismaRegistrationRepository's OWNER-role lookup).
      throw new InternalServerErrorException(
        `${input.role} role is not seeded; cannot create invitation.`,
      );
    }

    const rawToken = this.tokens.generateOpaqueToken();
    const expiresAt = new Date(
      Date.now() +
        this.configService.getOrThrow<number>(
          'tenants.invitationExpiresInSeconds',
        ) *
          1000,
    );

    const invitation = await this.invitations.create({
      tenantId,
      email,
      roleId: role.id,
      invitedByUserId: actor.sub,
      tokenHash: this.tokens.hashOpaqueToken(rawToken),
      expiresAt,
    });

    const acceptUrl = `${this.configService.getOrThrow<string>('mail.frontendUrl')}/auth/accept-invitation/${rawToken}`;
    await this.notifications.sendEmail({
      to: email,
      subject: "You've been invited to join a team on Kapis Receptionist",
      html: `<p>You've been invited to join as ${input.role}. Click below to accept and set up your account:</p><p><a href="${acceptUrl}">${acceptUrl}</a></p><p>This link expires in 7 days.</p>`,
      text: `Accept your invitation: ${acceptUrl} (expires in 7 days)`,
    });

    await this.auditLog.record({
      action: 'TENANT_INVITATION_CREATED',
      entityType: 'TenantInvitation',
      entityId: invitation.id,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { email, role: input.role },
    });

    return invitation;
  }

  async listPending(tenantId: string): Promise<TenantInvitationEntity[]> {
    return this.invitations.findPendingForTenant(tenantId);
  }

  async revoke(
    tenantId: string,
    invitationId: string,
    actor: AccessTokenPayload,
  ): Promise<void> {
    const invitation = await this.invitations.findByIdForTenant(
      tenantId,
      invitationId,
    );
    if (!invitation) {
      throw new TenantResourceNotFoundException();
    }
    if (invitation.acceptedAt || invitation.revokedAt) {
      return; // idempotent no-op, matching this API's DELETE conventions
    }

    await this.invitations.revoke(tenantId, invitationId);

    await this.auditLog.record({
      action: 'TENANT_INVITATION_REVOKED',
      entityType: 'TenantInvitation',
      entityId: invitationId,
      actorType: ActorType.USER,
      actorId: actor.sub,
      tenantId,
      metadata: { email: invitation.email },
    });
  }

  /**
   * Validates a raw invitation token (from the emailed link) without
   * mutating anything — `AuthService.acceptInvitation` calls this first,
   * then creates the `User`+`UserRole` in its own transaction, then calls
   * `markAccepted` only once that succeeds. If `markAccepted` fails after a
   * successful user creation (a narrow, rare window), the invitation stays
   * usable while a real user already exists — an accepted, documented
   * limitation for this class of low-stakes infrastructure data, not
   * booking/financial data, so it doesn't warrant a cross-module
   * distributed-transaction mechanism to close.
   */
  async validateAndConsume(rawToken: string): Promise<ConsumedInvitation> {
    const tokenHash = this.tokens.hashOpaqueToken(rawToken);
    const invitation = await this.invitations.findByTokenHash(tokenHash);

    if (
      !invitation ||
      invitation.acceptedAt ||
      invitation.revokedAt ||
      invitation.expiresAt.getTime() < Date.now()
    ) {
      throw new InvalidOrExpiredInvitationException();
    }

    return {
      invitationId: invitation.id,
      tenantId: invitation.tenantId,
      email: invitation.email,
      roleId: invitation.roleId,
      roleName: invitation.roleName,
    };
  }

  async markAccepted(
    invitationId: string,
    tenantId: string,
    newUserId: string,
  ): Promise<void> {
    await this.invitations.markAccepted(invitationId);

    await this.auditLog.record({
      action: 'TENANT_INVITATION_ACCEPTED',
      entityType: 'TenantInvitation',
      entityId: invitationId,
      actorType: ActorType.USER,
      actorId: newUserId,
      tenantId,
      metadata: {},
    });
  }
}
