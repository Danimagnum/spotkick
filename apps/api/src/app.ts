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
import { KafkaTransport } from './platform/kafka';
import { PlatformRelay } from './platform/relay';
import { Operations, OperationsController } from './platform/operations';
@Module({ controllers: [ApiController, OperationsController], providers: [
    Database, Ledger, CoreClient, Identity, RedisService, MatchEngine, SoloService, Runtime, GameGateway,
    KafkaTransport, PlatformRelay, Operations,
] })
export class AppModule {
}
