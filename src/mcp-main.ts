import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { McpService } from './mcp/mcp.service';

async function bootstrapMcp() {
  const logger = new Logger('MCP-Server');
  const app = await NestFactory.createApplicationContext(AppModule);

  const mcpService = app.get(McpService);
  const tools = mcpService.getToolDefinitions();

  logger.log(`🚀 Model Context Protocol (MCP) Server initialized.`);
  logger.log(`Available MCP tools: ${tools.map((t) => t.name).join(', ')}`);
}

bootstrapMcp().catch((err) => {
  console.error('MCP Server failed to start:', err);
  process.exit(1);
});
