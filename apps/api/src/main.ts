import './instrument';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app';
import { ErrorFilter } from './transport';
async function main(){
  for(const [key,min,max] of [['RAKE_BPS',0,1000],['CHOICE_MS',100,60000],['REVEAL_MS',100,10000],['BOT_AFTER_MS',0,60000],['RESULT_MS',0,10000]] as const){if(process.env[key]!==undefined&&(!Number.isInteger(Number(process.env[key]))||Number(process.env[key])<min||Number(process.env[key])>max))throw new Error(`Invalid ${key}`);}
  const app=await NestFactory.create(AppModule,{bodyParser:true});app.enableCors({origin:process.env.WEB_ORIGIN||'http://localhost:3000',methods:['GET','POST'],allowedHeaders:['Content-Type','Authorization']});app.useGlobalFilters(new ErrorFilter());app.enableShutdownHooks();await app.listen(Number(process.env.PORT||3001),'0.0.0.0');
}
main().catch(e=>{console.error(e);process.exit(1);});
