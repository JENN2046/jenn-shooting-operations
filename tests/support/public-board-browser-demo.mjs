// Isolated synthetic fixture only. Never points at a production volume or credential.
import {publicFixture} from './public-board-fixture.mjs';
import {launch} from './first-launch-v3-fixture.mjs';
const f=process.argv.includes('--private')?await launch():process.argv.includes('--empty')?await launch({publicBoard:true}):await publicFixture();
f.server.server.prependListener('request',request=>console.log(JSON.stringify({path:request.url,cookie:Boolean(request.headers.cookie),bearer:Boolean(request.headers.authorization)})));
await new Promise(r=>f.server.server.listen(0,'127.0.0.1',r));
console.log(JSON.stringify({url:`http://127.0.0.1:${f.server.server.address().port}`,syntheticOnly:true}));
async function stop(){await new Promise(r=>f.server.server.close(r));f.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
