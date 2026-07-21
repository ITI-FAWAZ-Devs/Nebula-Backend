import { registerAs } from '@nestjs/config';
import * as path from 'path';

export default registerAs('workspace', () => ({
  root: process.env.WORKSPACE_ROOT || path.resolve(process.cwd(), 'workspace'),
}));
