import {createPOSServer} from './server.mjs';
const port=Number(process.env.PORT||4188);
const server=createPOSServer();
server.listen(port,'127.0.0.1',()=>console.log(`Mr. Chicken House workspace\nhttp://localhost:${port}/`));