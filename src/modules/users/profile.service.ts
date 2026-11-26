import { Injectable } from '@nestjs/common';
import { avatarUrl } from '../../common/avatar-url';
import { PrismaService } from '../../database/prisma.service';

export interface Profile {
  id: string;
  email: string;
  fullName: string;
  /** `null` = no photo, the frontend shows initials. */
  avatarUrl: string | null;
  hasPassword: boolean;
  googleLinked: boolean;
}

/** Never returned as is: holds the password hash and Google subject. */
const profileSelect = {
  id: true,
  email: true,
  fullName: true,
  avatarObjectKey: true,
  passwordHash: true,
  googleSubject: true,
} as const;

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  async getProfile(userId: string): Promise<Profile> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: profileSelect });
    return toProfile(user);
  }

  async updateName(userId: string, fullName: string): Promise<Profile> {
    const user = await this.prisma.user.update({ where: { id: userId }, data: { fullName }, select: profileSelect });
    return toProfile(user);
  }
}

function toProfile(user: {
  id: string;
  email: string;
  fullName: string;
  avatarObjectKey: string | null;
  passwordHash: string | null;
  googleSubject: string | null;
}): Profile {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    avatarUrl: avatarUrl(user.avatarObjectKey),
    hasPassword: user.passwordHash !== null,
    googleLinked: user.googleSubject !== null,
  };
}
