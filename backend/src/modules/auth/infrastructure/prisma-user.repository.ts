import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthUser } from '../domain/entities/auth-user.entity';
import { UserRepositoryPort } from '../domain/ports/user-repository.port';
import {
  toAuthUser,
  userWithRolesInclude,
} from './mappers/prisma-auth.mappers';

@Injectable()
export class PrismaUserRepository implements UserRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByEmail(email: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: userWithRolesInclude,
    });
    return user ? toAuthUser(user) : null;
  }

  async findById(id: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: userWithRolesInclude,
    });
    return user ? toAuthUser(user) : null;
  }

  async updateLastLoginAt(id: string, when: Date): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { lastLoginAt: when },
    });
  }

  async markEmailVerified(id: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { isEmailVerified: true },
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash },
    });
  }
}
