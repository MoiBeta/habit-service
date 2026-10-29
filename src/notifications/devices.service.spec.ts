import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { DevicesService } from './devices.service';
import { PrismaService } from '../prisma/prisma.service';

describe('DevicesService', () => {
  let service: DevicesService;
  let prisma: {
    deviceToken: {
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      findMany: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      deviceToken: {
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        findMany: jest.fn(),
      },
    };
    service = new DevicesService(prisma as unknown as PrismaService);
  });

  describe('upsertToken', () => {
    it('should create a new token record when token does not exist', async () => {
      const expectedResult = {
        id: 'uuid-1',
        token: 'fcm-token-abc',
        userId: 'user-1',
        platform: 'android',
        createdAt: new Date(),
      };
      (prisma.deviceToken.upsert as jest.Mock).mockResolvedValue(
        expectedResult as never,
      );

      const result = await service.upsertToken(
        'user-1',
        'fcm-token-abc',
        'android',
      );

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'fcm-token-abc' },
        update: { userId: 'user-1', platform: 'android' },
        create: { token: 'fcm-token-abc', userId: 'user-1', platform: 'android' },
      });
      expect(result).toEqual(expectedResult);
    });

    it('should update existing token with new userId and platform when token already exists', async () => {
      const updatedResult = {
        id: 'uuid-1',
        token: 'fcm-token-abc',
        userId: 'user-2',
        platform: 'ios',
        createdAt: new Date(),
      };
      (prisma.deviceToken.upsert as jest.Mock).mockResolvedValue(
        updatedResult as never,
      );

      const result = await service.upsertToken(
        'user-2',
        'fcm-token-abc',
        'ios',
      );

      expect(prisma.deviceToken.upsert).toHaveBeenCalledWith({
        where: { token: 'fcm-token-abc' },
        update: { userId: 'user-2', platform: 'ios' },
        create: { token: 'fcm-token-abc', userId: 'user-2', platform: 'ios' },
      });
      expect(result).toEqual(updatedResult);
    });
  });

  describe('deleteToken', () => {
    it('should call prisma.deviceToken.deleteMany with the correct token', async () => {
      (prisma.deviceToken.deleteMany as jest.Mock).mockResolvedValue(
        undefined as never,
      );

      await service.deleteToken('fcm-token-to-delete');

      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'fcm-token-to-delete' },
      });
    });
  });

  describe('getTokensByUserId', () => {
    it('should return all device tokens for the given userId', async () => {
      const tokens = [
        {
          id: 'uuid-1',
          token: 'token-1',
          userId: 'user-1',
          platform: 'android',
          createdAt: new Date(),
        },
        {
          id: 'uuid-2',
          token: 'token-2',
          userId: 'user-1',
          platform: 'ios',
          createdAt: new Date(),
        },
      ];
      (prisma.deviceToken.findMany as jest.Mock).mockResolvedValue(
        tokens as never,
      );

      const result = await service.getTokensByUserId('user-1');

      expect(prisma.deviceToken.findMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
      });
      expect(result).toEqual(tokens);
    });
  });

  describe('deleteUserToken', () => {
    it("only deletes the token when it belongs to the user", async () => {
      (prisma.deviceToken.deleteMany as jest.Mock).mockResolvedValue({ count: 1 } as never);

      await service.deleteUserToken('user-1', 'fcm-token');

      expect(prisma.deviceToken.deleteMany).toHaveBeenCalledWith({
        where: { token: 'fcm-token', userId: 'user-1' },
      });
    });
  });
});
