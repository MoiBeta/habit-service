import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { App, cert, initializeApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export interface SendResult {
  success: boolean;
  tokenInvalid?: boolean;
}

@Injectable()
export class FirebaseService implements OnModuleInit {
  private readonly logger = new Logger(FirebaseService.name);
  private app: App | null = null;

  onModuleInit(): void {
    try {
      const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
      if (!credPath) {
        this.logger.warn(
          'GOOGLE_APPLICATION_CREDENTIALS not set. Push notifications disabled.',
        );
        return;
      }
      this.app = initializeApp({
        credential: cert(credPath),
      });
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize Firebase Admin SDK', error);
      this.app = null;
    }
  }

  async sendToDevice(
    token: string,
    payload: { title: string; body: string; data: Record<string, string> },
  ): Promise<SendResult> {
    if (!this.app) {
      return { success: false };
    }

    try {
      const messaging = getMessaging(this.app);
      await messaging.send({
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data,
      });
      return { success: true };
    } catch (error: any) {
      const errorCode = error?.code || error?.errorInfo?.code || '';
      if (
        errorCode.includes('registration-token-not-registered') ||
        errorCode.includes('invalid-registration-token')
      ) {
        return { success: false, tokenInvalid: true };
      }
      this.logger.error(
        `Failed to send notification to token: ${token}`,
        error,
      );
      return { success: false };
    }
  }
}
