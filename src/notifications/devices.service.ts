import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DeviceToken } from '@prisma/client';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertToken(
    userId: string,
    token: string,
    platform: string,
  ): Promise<DeviceToken> {
    return this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId, platform },
      create: { token, userId, platform },
    });
  }

  async deleteToken(token: string): Promise<void> {
    // deleteMany: the same invalid token can be reported by several sends.
    await this.prisma.deviceToken.deleteMany({ where: { token } });
  }

  /** Deletes a token only if it belongs to the given user. */
  async deleteUserToken(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
  }

  async getTokensByUserId(userId: string): Promise<DeviceToken[]> {
    return this.prisma.deviceToken.findMany({ where: { userId } });
  }
}
