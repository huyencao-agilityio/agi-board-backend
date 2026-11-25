import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { runInBackground } from '../../cloudflare';
import type { Env } from '../../config/env';

const RESEND_URL = 'https://api.resend.com/emails';
const MAILPIT_URL = 'http://localhost:8025/api/v1/send';

export interface EmailRecipient {
  id: string;
  email: string;
}

/** Sends email after the response (a wait would reveal through timing who has an account). Never throws. */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private readonly config: ConfigService<Env, true>) {}

  sendVerificationCode(to: EmailRecipient, code: string) {
    this.send(
      to,
      'Your AGI Board verification code',
      `Your verification code is ${code}.\n\nIt is valid for 10 minutes. If you did not sign up, ignore this email.`,
    );
  }

  sendAccountExists(to: EmailRecipient) {
    const signInUrl = `${this.config.get('APP_ORIGIN', { infer: true })}/sign-in`;
    this.send(
      to,
      'You already have an AGI Board account',
      `Someone tried to sign up with this email, which already has an account. Sign in instead: ${signInUrl}\n\nIf this was not you, ignore this email.`,
    );
  }

  private send(to: EmailRecipient, subject: string, text: string) {
    // A key in a developer's .env must never send real email from tests.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;
    try {
      runInBackground(this.deliver(to, subject, text));
    } catch (err) {
      // A failing runner must not turn only the requests that send email into a 500.
      this.logger.warn(`Email to user ${to.id} not scheduled: ${err instanceof Error ? err.name : 'unknown error'}`);
    }
  }

  private async deliver(to: EmailRecipient, subject: string, text: string): Promise<void> {
    const apiKey = this.config.get('EMAIL_API_KEY', { infer: true });
    try {
      const res = apiKey
        ? await this.post(
            RESEND_URL,
            { from: this.config.get('EMAIL_FROM', { infer: true }), to: [to.email], subject, text },
            { Authorization: `Bearer ${apiKey}` },
          )
        : await this.post(MAILPIT_URL, {
            From: { Email: 'no-reply@example.com', Name: 'AGI Board' },
            To: [{ Email: to.email }],
            Subject: subject,
            Text: text,
          });
      // The provider's body can quote the address, so only the status is logged.
      if (!res.ok) this.logger.warn(`Email to user ${to.id} failed with ${res.status}`);
    } catch (err) {
      this.logger.warn(`Email to user ${to.id} failed: ${err instanceof Error ? err.name : 'unknown error'}`);
    }
  }

  private post(url: string, body: unknown, headers: Record<string, string> = {}) {
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  }
}
