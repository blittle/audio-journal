import { config } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class ConversationSession {
  readonly callSid: string;
  readonly userId: string;
  streamSid: string = "";
  readonly startedAt: Date;

  private messages: ChatMessage[] = [];
  private transcriptParts: string[] = [];
  private audioChunks: Int16Array[] = [];
  private audioSampleCount = 0;
  private silentMs = 0;
  private _isProcessing = false;
  private markCounter = 0;
  private _userSpoke = false;
  private _idleMs = 0;
  private _promptedStillThere = false;
  private _isPlaying = false;
  private _skipJournal = false;
  private _userTurnCount = 0;

  constructor(callSid: string, userId: string, systemPrompt: string) {
    this.callSid = callSid;
    this.userId = userId;
    this.startedAt = new Date();
    this.messages.push({ role: "system", content: systemPrompt });
  }

  appendAudio(pcm: Int16Array): void {
    this.audioChunks.push(pcm);
    this.audioSampleCount += pcm.length;
  }

  getBufferedAudio(): Int16Array {
    if (this.audioChunks.length === 0) return new Int16Array(0);
    const result = new Int16Array(this.audioSampleCount);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }

  clearAudioBuffer(): void {
    this.audioChunks = [];
    this.audioSampleCount = 0;
  }

  hasBufferedAudio(): boolean {
    return this.audioSampleCount > 0;
  }

  incrementSilence(ms: number): void {
    this.silentMs += ms;
  }

  resetSilence(): void {
    this.silentMs = 0;
  }

  getSilentMs(): number {
    return this.silentMs;
  }

  isSilenceThresholdReached(): boolean {
    return this.silentMs >= config.SILENCE_THRESHOLD_MS;
  }

  addUserMessage(text: string): void {
    this.messages.push({ role: "user", content: text });
    this.transcriptParts.push(`User: ${text}`);
    this._userTurnCount++;
  }

  get userTurnCount(): number {
    return this._userTurnCount;
  }

  addAssistantMessage(text: string): void {
    this.messages.push({ role: "assistant", content: text });
    this.transcriptParts.push(`Assistant: ${text}`);
  }

  getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  getTranscript(): string {
    return this.transcriptParts.join("\n");
  }

  get isProcessing(): boolean {
    return this._isProcessing;
  }

  startProcessing(): boolean {
    if (this._isProcessing) return false;
    this._isProcessing = true;
    return true;
  }

  finishProcessing(): void {
    this._isProcessing = false;
  }

  nextMarkName(): string {
    this.markCounter++;
    return `response-${this.markCounter}`;
  }

  markUserSpoke(): void {
    this._userSpoke = true;
  }

  hasUserSpoken(): boolean {
    return this._userSpoke;
  }

  incrementIdle(ms: number): void {
    this._idleMs += ms;
  }

  resetIdle(): void {
    this._idleMs = 0;
    this._promptedStillThere = false;
  }

  getIdleMs(): number {
    return this._idleMs;
  }

  get promptedStillThere(): boolean {
    return this._promptedStillThere;
  }

  markPromptedStillThere(): void {
    this._promptedStillThere = true;
  }

  get isPlaying(): boolean {
    return this._isPlaying;
  }

  startPlaying(): void {
    this._isPlaying = true;
  }

  stopPlaying(): void {
    this._isPlaying = false;
  }

  markSkipJournal(): void {
    this._skipJournal = true;
  }

  get shouldSkipJournal(): boolean {
    return this._skipJournal;
  }

  getDurationMinutes(): number {
    return Math.round((Date.now() - this.startedAt.getTime()) / 60000);
  }
}

const sessions = new Map<string, ConversationSession>();

export function getSession(callSid: string): ConversationSession | undefined {
  return sessions.get(callSid);
}

export function setSession(callSid: string, session: ConversationSession): void {
  sessions.set(callSid, session);
}

export function removeSession(callSid: string): ConversationSession | undefined {
  const session = sessions.get(callSid);
  sessions.delete(callSid);
  return session;
}
