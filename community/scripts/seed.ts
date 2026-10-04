import { readConfig } from '../src/config.js';
import { openDb } from '../src/db/index.js';
import { join } from 'node:path';
const config=readConfig();const db=openDb(join(config.dataDir,'community.sqlite'));
console.log('基础板块和标签已就绪。开发内容 seed 随 C2 提供。');db.close();
