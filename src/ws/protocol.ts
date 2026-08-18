export type InboundSubscribeFrame = {
  type: 'subscribe';
  conversationIds: number[];
};

export type InboundTypingFrame = {
  type: 'typing';
  conversationId: number;
  isTyping: boolean;
};

export type InboundFrame = InboundSubscribeFrame | InboundTypingFrame;

export type OutboundMessageFrame = {
  type: 'message';
  id: number;
  conversationId: number;
  senderId: number;
  body: string;
  createdAt: string;
};

export type OutboundTypingFrame = {
  type: 'typing';
  conversationId: number;
  userId: number;
  isTyping: boolean;
};

export type OutboundFrame = OutboundMessageFrame | OutboundTypingFrame;

export function isOutboundTypingFrame(payload: unknown): payload is OutboundTypingFrame {
  return (
    typeof payload === 'object' &&
    payload !== null &&
    (payload as OutboundTypingFrame).type === 'typing'
  );
}
