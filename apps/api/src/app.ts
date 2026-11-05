import { Module } from '@nestjs/common';
import { Database } from './database/db';
import { Ledger } from './wallet/ledger';
import { Identity } from './identity';
import { RedisService } from './redis';
import { MatchEngine } from './matches/engine';
import { SoloService } from './solo/solo';
import { Runtime } from './runtime';
import { ApiController,GameGateway } from './transport';
@Module({controllers:[ApiController],providers:[Database,Ledger,Identity,RedisService,MatchEngine,SoloService,Runtime,GameGateway]})
export class AppModule {}
