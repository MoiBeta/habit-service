import { Injectable, HttpException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class UsersService {
    private authServiceUrl: string;

    constructor(
        private http: HttpService,
        private config: ConfigService,
    ) {
        this.authServiceUrl = this.config.get('AUTH_SERVICE_URL') || 'http://auth-service:3000';
    }

    async validateUser(userId: string) {
        try {
            const response = await lastValueFrom(
                this.http
                .get(`${this.authServiceUrl}/users/${userId}`),
            );
            return response;
        } catch (error) {
            if (error instanceof Error) {
                console.error(`Error validating user ${userId}:`, error.message);
            } else {
                console.error(`Unknown error validating user ${userId}:`, error);
            }

            throw new HttpException('Failed to validate user with auth service', 503);
        }
    }
}
