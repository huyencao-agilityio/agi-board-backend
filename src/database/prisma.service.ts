import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaD1 } from '@prisma/adapter-d1';
import { getBindings } from '../cloudflare';
import { PrismaClient } from '../generated/prisma/client';

/** On D1, `$transaction` (both forms) is not atomic; use `getBindings().DB.batch()` for all-or-nothing writes. */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({ adapter: new PrismaD1(getBindings().DB) });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
