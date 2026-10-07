import { type ConversationRow } from '@/lib/conversations/resolve';
import { checkIsAccountOwner } from '@/lib/ai/chatbot-engine';
import { type OwnedListing } from '@/lib/owners/owner-reply';
import type {
  ContactRow,
  WhatsAppMessage,
} from '@/lib/whatsapp/webhook-handler';

export interface InboundChainPayload {
  message: WhatsAppMessage;
  configOwnerUserId: string;
  phoneNumberId: string;
  senderPhone: string;
  contactWasCreated: boolean;
  contactRecord: ContactRow;
  conversation: ConversationRow;
  contentText: string | null;
  interactiveReplyId: string | null;
  nfmResponseJson: string | null;
  routingUpdate: {
    assigned_agent_id?: string | null;
    assigned_team_id?: string | null;
    routing_rule_used?: string | null;
    assigned_at?: string | null;
  };
  enquiryPropertyId: string | null;
  enquiryIsDeliberate: boolean;
  enquiryPropertyTitle: string | null;
  enquiryPropertyStatus?: string | null;
  specificPropertyInterest: boolean;
  propertyReferenceNeedsAgent: boolean;
  isFirstInboundMessage: boolean;
  ownerCheck: Awaited<ReturnType<typeof checkIsAccountOwner>>;
}

export interface InboundChainContext {
  accountId: string;
  accessToken: string;
  message: WhatsAppMessage;
  configOwnerUserId: string;
  phoneNumberId: string;
  senderPhone: string;
  contactWasCreated: boolean;
  contentText: string | null;
  interactiveReplyId: string | null;
  nfmResponseJson: string | null;
  routingUpdate: InboundChainPayload['routingUpdate'];
  enquiryPropertyId: string | null;
  enquiryIsDeliberate: boolean;
  enquiryPropertyTitle: string | null;
  enquiryPropertyStatus: string | null;
  specificPropertyInterest: boolean;
  propertyReferenceNeedsAgent: boolean;
  ownerCheck: InboundChainPayload['ownerCheck'];
  contactRecord: ContactRow;
  conversation: ConversationRow;
  waited: boolean;
  isFirstInboundMessage: boolean;
  isControlReply: boolean;
  assignedAgentUserId: string;
  isTextMessage: boolean;
  buyerRequirementMessage: boolean;
  ownedListings: OwnedListing[];
  isPropertyOwnerSender: boolean;
  agentHandling: boolean;
  inboundText: string;
  tappedHumanRequest: string | null;
  flowConsumed: boolean;
}

export type StepResult = 'handled' | 'continue';

export interface InboundStep {
  name: string;
  run: (ctx: InboundChainContext) => Promise<StepResult>;
}
