import { registerAs } from '@nestjs/config';

export default registerAs('chroma', () => ({
  host: process.env.CHROMA_HOST || 'http://localhost:8000',
  apiKey: process.env.CHROMA_API_KEY || '',
  tenant: process.env.CHROMA_TENANT || 'default_tenant',
  database: process.env.CHROMA_DATABASE || 'default_database',
}));
