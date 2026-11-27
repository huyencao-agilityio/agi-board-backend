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

const oneLine = (text: string, max: number) => text.replace(/\s+/g, ' ').trim().slice(0, max);

/** Sends email after the response (a wait would reveal through timing who gets a code). Never throws. */
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

  /** The token goes in the fragment, which browsers never send to a server or in `Referer`. */
  sendResetLink(to: EmailRecipient, token: string) {
    this.send(
      to,
      'Reset your AGI Board password',
      `Open this link to set a new password:\n\n${this.appOrigin()}/reset-password#token=${token}\n\nIt is valid for 30 minutes and can be used once. If you did not ask for it, ignore this email.`,
    );
  }

  sendGoogleSignInNotice(to: EmailRecipient) {
    this.send(
      to,
      'Sign in to AGI Board with Google',
      `Someone asked to reset the password for this email. Your account uses Google sign-in and has no password.\n\nUse Continue with Google at ${this.appOrigin()}/sign-in. If you did not ask for it, ignore this email.`,
    );
  }

  /** Invites are matched by email at sign-in, so the link carries no token (specs/21 research R7). */
  sendWorkspaceInvite(to: EmailRecipient, inviterName: string, workspaceName: string) {
    // User-written names go out from our sender: one line each, bounded, so they cannot inject paragraphs.
    inviterName = oneLine(inviterName, 100);
    workspaceName = oneLine(workspaceName, 100);
    this.send(
      to,
      `${inviterName} invited you to ${workspaceName} on AGI Board`,
      `${inviterName} invited you to join the workspace "${workspaceName}" on AGI Board.\n\nSign in or sign up with this email address at ${this.appOrigin()}/ and accept the invite on your Home page. It is valid for 14 days.\n\nIf you did not expect it, ignore this email.`,
    );
  }

  private appOrigin() {
    return this.config.get('APP_ORIGIN', { infer: true });
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
