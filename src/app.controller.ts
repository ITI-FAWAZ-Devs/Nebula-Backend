import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';

@Controller()
export class AppController {
  @Public()
  @Get()
  getHealth() {
    return {
      service: 'Nebula API',
      status: 'operational',
      timestamp: new Date().toISOString(),
    };
  }
}
