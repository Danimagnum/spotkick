import { Module } from '@nestjs/common';
import { Database } from './database/db';
import { Ledger } from './wallet/ledger';
import { CoreClient } from './wallet/core-client';
import { Identity } from './identity';
import { RedisService } from './redis';
import { MatchEngine } from './matches/engine';
import { SoloService } from './solo/solo';
import { Runtime } from './runtime';
import { ApiController, GameGateway } from './transport';
@Module({ controllers: [ApiController], providers: [Database, Ledger, CoreClient, Identity, RedisService, MatchEngine, SoloService, Runtime, GameGateway] })
export class AppModule {
}
