import { validateSync } from 'class-validator';
import { failedPasswordRules, IsNewPassword } from './password-rules';

const email = 'an.nguyen@example.com';
const SHORT = 'password must have at least 8 characters';
const LONG = 'password must have at most 128 characters';
const LETTER = 'password must contain a letter';
const NUMBER = 'password must contain a number';
const NAME = 'password must not contain the email name';

describe('failedPasswordRules', () => {
  it.each([
    ['an acceptable password', 'abcd1234', email, []],
    ['exactly 128 characters', `a1${'x'.repeat(126)}`, email, []],
    ['an accented letter', '1234567ế', email, []],
    ['7 characters', 'abcd123', email, [SHORT]],
    ['129 characters', `a1${'x'.repeat(127)}`, email, [LONG]],
    ['no letter', '12345678', email, [LETTER]],
    ['no number', 'abcdefgh', email, [NUMBER]],
    ['the email name in another case', 'xAN.Nguyen1', email, [NAME]],
    ['several at once', 'abc', email, [SHORT, NUMBER]],
    ['a one-letter email name', 'abcd1234', 'a@example.com', [NAME]],
    ['an empty email', 'abcd1234', '', []],
    ['an email without @', 'abcd1234', 'abcd', [NAME]],
  ])('%s', (_name, password, mail, expected) => {
    expect(failedPasswordRules(password, mail)).toEqual(expected);
  });
});

describe('IsNewPassword', () => {
  class Dto {
    email: unknown;
    @IsNewPassword()
    password: unknown;
  }
  const messages = (password: unknown, mail: unknown) =>
    validateSync(Object.assign(new Dto(), { password, email: mail })).flatMap((e) => Object.values(e.constraints!));

  it('reports every broken rule as its own message', () => {
    expect(messages('abc', email).sort()).toEqual([SHORT, NUMBER].sort());
    expect(messages('abcd1234', email)).toEqual([]);
  });

  it('does not throw on values that are not strings', () => {
    expect(messages('abcd1234', undefined)).toEqual([]);
    expect(messages(42, 7)).not.toEqual([]);
  });
});
