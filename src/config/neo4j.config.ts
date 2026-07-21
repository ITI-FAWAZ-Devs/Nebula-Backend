import { registerAs } from '@nestjs/config';

export default registerAs('neo4j', () => ({
  uri: process.env.NEO4J_URI,
  username: process.env.NEO4J_USERNAME,
  password: process.env.NEO4J_PASSWORD,
  database: process.env.NEO4J_DATABASE || 'neo4j',
}));
