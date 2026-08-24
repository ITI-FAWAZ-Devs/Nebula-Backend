import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import { VoiceAgentService, VoiceSession } from './voice-agent.service';

interface JwtUser {
  sub: string;
  email: string;
}

@WebSocketGateway({
  namespace: '/voice',
  cors: {
    // Must be a specific origin (not '*') when credentials/cookies are used
    origin: (process.env.FRONTEND_URL || 'http://localhost:3000').split(','),
    credentials: true,
  },
})
export class VoiceGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(VoiceGateway.name);

  constructor(
    private readonly voiceAgentService: VoiceAgentService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  // ─── Connection lifecycle ─────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = await this.authenticateSocket(client);
      if (!userId) {
        client.emit('error', { message: 'Unauthorized' });
        client.disconnect();
        return;
      }
      // Attach userId to socket data for later handlers
      client.data.userId = userId;
      this.logger.log(`Voice socket connected: ${client.id} user=${userId}`);
    } catch {
      client.emit('error', { message: 'Authentication failed' });
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket): Promise<void> {
    await this.voiceAgentService.destroySession(client.id);
    this.logger.log(`Voice socket disconnected: ${client.id}`);
  }

  // ─── Client → Server events ──────────────────────────────────────────────

  @SubscribeMessage('session.start')
  async onSessionStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { repositoryId: string },
  ) {
    const userId = client.data.userId as string;
    if (!userId) {
      client.emit('error', { message: 'Not authenticated' });
      return;
    }
    if (!data?.repositoryId) {
      client.emit('error', { message: 'repositoryId is required' });
      return;
    }

    try {
      const session = await this.voiceAgentService.createSession(
        client.id,
        userId,
        data.repositoryId,
        {
          onState: (state) => client.emit('state', { state }),
          onSttPartial: (text) => client.emit('stt.partial', { text }),
          onSttFinal: (text) => client.emit('stt.final', { text }),
          onAgentToken: (token) => client.emit('agent.token', { token }),
          onAgentDone: (payload) => client.emit('agent.done', payload),
          onTtsAudio: (chunk) => client.emit('tts.audio', chunk),
          onError: (message) => client.emit('error', { message }),
        },
      );

      await session.startListening();
      this.logger.log(
        `Voice session started: ${client.id} repo=${data.repositoryId}`,
      );
    } catch (err) {
      const msg = (err as Error).message ?? 'Failed to start session';
      client.emit('error', { message: msg });
    }
  }

  @SubscribeMessage('audio.chunk')
  onAudioChunk(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: Buffer | { data: number[] } | ArrayBuffer,
  ) {
    const session = this.requireSession(client);
    if (!session) return;

    const chunk = toBuffer(data);
    if (chunk) {
      session.pushAudio(chunk);
    }
  }

  @SubscribeMessage('utterance.end')
  async onUtteranceEnd(@ConnectedSocket() client: Socket) {
    const session = this.requireSession(client);
    if (!session) return;
    await session.commitUtterance();
  }

  /** Typed text from the user — skips STT, goes straight to the agent */
  @SubscribeMessage('text.utterance')
  async onTextUtterance(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { text: string },
  ) {
    const session = this.requireSession(client);
    if (!session) return;
    if (!data?.text?.trim()) return;
    await session.processTextInput(data.text);
  }

  @SubscribeMessage('interrupt')
  async onInterrupt(@ConnectedSocket() client: Socket) {
    const session = this.requireSession(client);
    if (!session) return;
    await session.interrupt();
    this.logger.debug(`Barge-in interrupt: ${client.id}`);
  }

  @SubscribeMessage('session.stop')
  async onSessionStop(@ConnectedSocket() client: Socket) {
    await this.voiceAgentService.destroySession(client.id);
    client.emit('state', { state: 'idle' });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private requireSession(client: Socket): VoiceSession | null {
    const session = this.voiceAgentService.getSession(client.id);
    if (!session) {
      client.emit('error', {
        message: 'No active voice session. Send session.start first.',
      });
      return null;
    }
    return session;
  }

  private async authenticateSocket(client: Socket): Promise<string | null> {
    const secret = this.configService.get<string>('auth.jwtAccessSecret')!;

    // Helper: verify a raw JWT string, return sub or null
    const verify = (raw: string | undefined): string | null => {
      if (!raw) return null;
      try {
        const payload = this.jwtService.verify<JwtUser>(raw, { secret });
        return payload.sub ?? null;
      } catch {
        return null;
      }
    };

    // 1. Explicit token in socket auth (sent by frontend when available)
    const authToken = (client.handshake.auth as Record<string, string>)?.token;
    const fromAuth = verify(authToken);
    if (fromAuth) return fromAuth;

    // 2. Authorization: Bearer header
    const bearerHeader = client.handshake.headers.authorization;
    const fromBearer = verify(bearerHeader?.replace(/^Bearer\s+/i, ''));
    if (fromBearer) return fromBearer;

    // 3. nebula_access_token HttpOnly cookie sent with the WS upgrade request
    const cookieHeader = client.handshake.headers.cookie;
    if (cookieHeader) {
      for (const part of cookieHeader.split(';')) {
        const trimmed = part.trim();
        if (trimmed.startsWith('nebula_access_token=')) {
          // Cookie value may start after the first '=' (JWT itself contains '.')
          const raw = trimmed.slice('nebula_access_token='.length);
          const fromCookie = verify(decodeURIComponent(raw));
          if (fromCookie) return fromCookie;
        }
      }
    }

    return null;
  }
}

// ─── Buffer coercion ─────────────────────────────────────────────────────────

function toBuffer(data: unknown): Buffer | null {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (
    data &&
    typeof data === 'object' &&
    'data' in data &&
    Array.isArray((data as { data: unknown[] }).data)
  ) {
    return Buffer.from((data as { data: number[] }).data);
  }
  return null;
}
