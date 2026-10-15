import {startOperationsFromEnv} from './server.mjs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
export {conversationFactoryFromEnv} from './conversation-runtime-v1.mjs';
import {conversationFactoryFromEnv} from './conversation-runtime-v1.mjs';
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))startOperationsFromEnv({conversationBoundaryFactory:conversationFactoryFromEnv()});
