import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { FirebaseService } from './firebase.service';

// Mock firebase-admin/app
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn(),
  cert: jest.fn(),
}));

// Mock firebase-admin/messaging
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(),
}));

// Import mocked modules
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

const mockedInitializeApp = initializeApp as jest.MockedFunction<
  typeof initializeApp
>;
const mockedCert = cert as jest.MockedFunction<typeof cert>;
const mockedGetMessaging = getMessaging as jest.MockedFunction<
  typeof getMessaging
>;

describe('FirebaseService', () => {
  let service: FirebaseService;

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    service = new FirebaseService();
  });

  describe('onModuleInit', () => {
    it('should set app to null and log warning when GOOGLE_APPLICATION_CREDENTIALS is not set', () => {
      service.onModuleInit();

      expect(mockedInitializeApp).not.toHaveBeenCalled();
      expect(mockedCert).not.toHaveBeenCalled();
    });

    it('should set app to null when initializeApp throws an error', () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/invalid/path.json';
      mockedCert.mockReturnValue({} as any);
      mockedInitializeApp.mockImplementation(() => {
        throw new Error('Invalid credentials');
      });

      service.onModuleInit();

      expect(mockedCert).toHaveBeenCalledWith('/invalid/path.json');
      expect(mockedInitializeApp).toHaveBeenCalled();
      // app should be null, so sendToDevice should return { success: false }
    });

    it('should initialize app successfully when credentials are valid', () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/valid/path.json';
      const fakeApp = { name: 'test-app' } as any;
      const fakeCred = { getAccessToken: jest.fn() } as any;
      mockedCert.mockReturnValue(fakeCred);
      mockedInitializeApp.mockReturnValue(fakeApp);

      service.onModuleInit();

      expect(mockedCert).toHaveBeenCalledWith('/valid/path.json');
      expect(mockedInitializeApp).toHaveBeenCalledWith({
        credential: fakeCred,
      });
    });
  });

  describe('sendToDevice', () => {
    const payload = {
      title: 'Test Title',
      body: 'Test Body',
      data: { habitId: 'habit-123' },
    };

    it('should return { success: false } when app is null (credentials not set)', async () => {
      // onModuleInit not called or credentials missing → app is null
      service.onModuleInit();

      const result = await service.sendToDevice('some-token', payload);

      expect(result).toEqual({ success: false });
      expect(mockedGetMessaging).not.toHaveBeenCalled();
    });

    it('should return { success: false } when app is null (initializeApp threw)', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/invalid/path.json';
      mockedCert.mockReturnValue({} as any);
      mockedInitializeApp.mockImplementation(() => {
        throw new Error('Init failed');
      });

      service.onModuleInit();
      const result = await service.sendToDevice('some-token', payload);

      expect(result).toEqual({ success: false });
      expect(mockedGetMessaging).not.toHaveBeenCalled();
    });

    it('should call messaging.send() and return { success: true } when app is initialized', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/valid/path.json';
      const fakeApp = { name: 'test-app' } as any;
      const mockSend = jest.fn<(msg: any) => Promise<string>>().mockResolvedValue('message-id');
      mockedCert.mockReturnValue({} as any);
      mockedInitializeApp.mockReturnValue(fakeApp);
      mockedGetMessaging.mockReturnValue({ send: mockSend } as any);

      service.onModuleInit();
      const result = await service.sendToDevice('device-token-123', payload);

      expect(result).toEqual({ success: true });
      expect(mockedGetMessaging).toHaveBeenCalledWith(fakeApp);
      expect(mockSend).toHaveBeenCalledWith({
        token: 'device-token-123',
        notification: { title: 'Test Title', body: 'Test Body' },
        data: { habitId: 'habit-123' },
      });
    });

    it('should return { success: false, tokenInvalid: true } when send throws registration-token-not-registered', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/valid/path.json';
      const fakeApp = { name: 'test-app' } as any;
      const mockSend = jest.fn<() => Promise<string>>().mockRejectedValue({
        code: 'messaging/registration-token-not-registered',
      });
      mockedCert.mockReturnValue({} as any);
      mockedInitializeApp.mockReturnValue(fakeApp);
      mockedGetMessaging.mockReturnValue({ send: mockSend } as any);

      service.onModuleInit();
      const result = await service.sendToDevice('expired-token', payload);

      expect(result).toEqual({ success: false, tokenInvalid: true });
    });

    it('should return { success: false, tokenInvalid: true } when send throws with errorInfo code', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/valid/path.json';
      const fakeApp = { name: 'test-app' } as any;
      const mockSend = jest.fn<() => Promise<string>>().mockRejectedValue({
        errorInfo: { code: 'messaging/invalid-registration-token' },
      });
      mockedCert.mockReturnValue({} as any);
      mockedInitializeApp.mockReturnValue(fakeApp);
      mockedGetMessaging.mockReturnValue({ send: mockSend } as any);

      service.onModuleInit();
      const result = await service.sendToDevice('invalid-token', payload);

      expect(result).toEqual({ success: false, tokenInvalid: true });
    });

    it('should return { success: false } when send throws a non-token error', async () => {
      process.env.GOOGLE_APPLICATION_CREDENTIALS = '/valid/path.json';
      const fakeApp = { name: 'test-app' } as any;
      const mockSend = jest.fn<() => Promise<string>>().mockRejectedValue(
        new Error('Network error'),
      );
      mockedCert.mockReturnValue({} as any);
      mockedInitializeApp.mockReturnValue(fakeApp);
      mockedGetMessaging.mockReturnValue({ send: mockSend } as any);

      service.onModuleInit();
      const result = await service.sendToDevice('some-token', payload);

      expect(result).toEqual({ success: false });
    });
  });
});
