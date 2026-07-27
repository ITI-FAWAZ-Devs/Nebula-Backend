// Direct graph neighbor of login.ts — manages user sessions
import { login } from './login';

export class SessionManager {
  startSession(user: string): string {
    return `session-${user}-${Date.now()}`;
  }
}
