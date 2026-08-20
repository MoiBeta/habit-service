import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import {
  INestApplication,
  ValidationPipe,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import request from 'supertest';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

describe('DevicesController (integration)', () => {
  let app: INestApplication;
  let devicesService: { upsertToken: jest.Mock };

  const mockUser = { id: 'user-123', email: 'test@test.com', role: 'user' };

  beforeEach(async () => {
    devicesService = {
      upsertToken: jest.fn().mockResolvedValue({
        id: 'uuid-1',
        token: 'fcm-token',
        userId: 'user-123',
        platform: 'android',
        createdAt: new Date(),
      } as never),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [DevicesController],
      providers: [
        {
          provide: DevicesService,
          useValue: devicesService,
        },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({
        canActivate: (context: ExecutionContext) => {
          const req = context.switchToHttp().getRequest();
          req.user = mockUser;
          return true;
        },
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('POST /devices/token', () => {
    it('should register token successfully with valid auth and body', async () => {
      const response = await request(app.getHttpServer())
        .post('/devices/token')
        .send({ token: 'fcm-token', platform: 'android' })
        .expect(201);

      expect(response.body).toEqual({ success: true });
      expect(devicesService.upsertToken).toHaveBeenCalledWith(
        'user-123',
        'fcm-token',
        'android',
      );
    });

    it('should handle duplicate token by calling upsertToken (which updates)', async () => {
      devicesService.upsertToken.mockResolvedValue({
        id: 'uuid-1',
        token: 'duplicate-token',
        userId: 'user-123',
        platform: 'android',
        createdAt: new Date(),
      } as never);

      const response = await request(app.getHttpServer())
        .post('/devices/token')
        .send({ token: 'duplicate-token', platform: 'android' })
        .expect(201);

      expect(response.body).toEqual({ success: true });
      expect(devicesService.upsertToken).toHaveBeenCalledWith(
        'user-123',
        'duplicate-token',
        'android',
      );
    });

    it('should return 401 when authentication is missing', async () => {
      // Create a separate app instance with a guard that rejects
      const moduleFixture: TestingModule = await Test.createTestingModule({
        controllers: [DevicesController],
        providers: [
          {
            provide: DevicesService,
            useValue: devicesService,
          },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useValue({
          canActivate: () => {
            throw new UnauthorizedException();
          },
        })
        .compile();

      const unauthApp = moduleFixture.createNestApplication();
      unauthApp.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
        }),
      );
      await unauthApp.init();

      await request(unauthApp.getHttpServer())
        .post('/devices/token')
        .send({ token: 'fcm-token', platform: 'android' })
        .expect(401);

      await unauthApp.close();
    });

    it('should return 400 when body is empty', async () => {
      await request(app.getHttpServer())
        .post('/devices/token')
        .send({})
        .expect(400);
    });

    it('should return 400 when token is missing', async () => {
      await request(app.getHttpServer())
        .post('/devices/token')
        .send({ platform: 'android' })
        .expect(400);
    });

    it('should return 400 when platform is missing', async () => {
      await request(app.getHttpServer())
        .post('/devices/token')
        .send({ token: 'fcm-token' })
        .expect(400);
    });
  });
});
