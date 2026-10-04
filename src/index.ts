import {buildApp} from './app.js';

const app=buildApp();
app.listen({port:Number(process.env.PORT||6301),host:'127.0.0.1'}).catch(err=>{app.log.error(err);process.exit(1)});
