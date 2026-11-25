import { applyDecorators } from '@nestjs/common';
import { ValidateBy, type ValidationArguments } from 'class-validator';

type Rule = { name: string; message: string; ok: (password: string, email: string) => boolean };

const RULES: Rule[] = [
  { name: 'minLength', message: 'password must have at least 8 characters', ok: (p) => p.length >= 8 },
  { name: 'maxLength', message: 'password must have at most 128 characters', ok: (p) => p.length <= 128 },
  { name: 'letter', message: 'password must contain a letter', ok: (p) => /\p{L}/u.test(p) },
  { name: 'number', message: 'password must contain a number', ok: (p) => /\d/.test(p) },
  {
    name: 'emailName',
    message: 'password must not contain the email name',
    ok: (p, email) => {
      const name = email.trim().toLowerCase().split('@')[0];
      return !name || !p.toLowerCase().includes(name);
    },
  },
];

/** The messages of the rules this new password breaks; empty when it is acceptable. */
export function failedPasswordRules(password: string, email: string): string[] {
  return RULES.filter((rule) => !rule.ok(password, email)).map((rule) => rule.message);
}

/** Rules for a new password (sign-up, reset), one error message per broken rule. Reads `email` from the same DTO. */
export function IsNewPassword() {
  return applyDecorators(
    ...RULES.map((rule) =>
      ValidateBy({
        name: `newPassword_${rule.name}`,
        validator: {
          validate: (value: unknown, args?: ValidationArguments) => {
            const email = (args?.object as { email?: unknown } | undefined)?.email;
            return typeof value === 'string' && rule.ok(value, typeof email === 'string' ? email : '');
          },
          defaultMessage: () => rule.message,
        },
      }),
    ),
  );
}
