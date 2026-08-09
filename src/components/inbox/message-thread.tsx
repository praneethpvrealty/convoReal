"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import type {
  Conversation,
  Message,
  MessageReaction,
  Contact,
  ConversationStatus,
  MessageTemplate,
  Profile,
} from "@/types";
import Link from "next/link";
import {
  LogCallPrompt,
  type PendingDial,
} from "@/components/contacts/log-call-prompt";
import {
  MessageSquare,
  ChevronDown,
  UserPlus,
  Check,
  Clock,
  ArrowLeft,
  RefreshCw,
  Archive,
  ArchiveRestore,
  Waypoints,
  Phone,
  Pin,
} from "lucide-react";
import { format, isToday, isYesterday, differenceInHours } from "date-fns";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageBubble } from "./message-bubble";
import { MessageActions, actionableText } from "./message-actions";
import {
  HIDE_CONFIRM_MESSAGE,
  pinAction,
  pinnedMessages,
  visibleMessages,
} from "@/lib/whatsapp/message-state";
import { ForwardMessageDialog } from "./forward-message-dialog";
import { MessageComposer } from "./message-composer";
import { TemplatePicker } from "./template-picker";
import { buildReplyPreview } from "./reply-quote";
import { MessageBubbleLoader } from "@/components/ui/message-bubble-loader";
import { ConvoRealLoader } from "@/components/ui/convoreal-loader";
import { NameTagBadge } from "@/components/contacts/name-tag-badge";
import { isReengagementError } from "@/lib/whatsapp/customer-window";
import { toast } from "sonner";

interface ReplyDraft {
  id: string;
  authorLabel: string;
  preview: string;
}

function renderTemplateBody(body: string, params: string[]): string {
  return body.replace(/\{\{(\d+)\}\}/g, (_, raw) => {
    const idx = Number(raw) - 1;
    return params[idx] ?? `{{${raw}}}`;
  });
}

interface MessageThreadProps {
  conversation: Conversation | null;
  contact: Contact | null;
  messages: Message[];
  onMessagesLoaded: (messages: Message[]) => void;
  onNewMessage: (message: Message) => void;
  onUpdateMessage: (id: string, updates: Partial<Message>) => void;
  onStatusChange: (conversationId: string, status: ConversationStatus) => void;
  onAssignChange: (
    conversationId: string,
    assignedAgentId: string | null,
    assignedTeamId: string | null,
  ) => void;
  /**
   * On mobile, the thread is shown full-screen with the conversation list
   * hidden. This callback lets the page deselect the active conversation
   * and reveal the list again. Rendered as a back-arrow in the header on
   * mobile only.
   */
  onBack?: () => void;
  /**
   * Increment to force the messages + reactions fetch effects to refire.
   * Parent bumps this on realtime reconnect / tab visibility → visible
   * so the open thread catches up on any events sent while the WS was
   * disconnected or the tab was throttled. Optional so existing callers
   * keep working.
   */
  resyncToken?: number;
  /**
   * Fired by the manual-refresh button in the thread header. The parent
   * typically bumps the same `resyncToken` it controls — this gives the
   * user a way to force a refetch when they suspect realtime missed an
   * event (or they're impatient). Optional so existing callers keep
   * working; the button is only rendered when this is provided.
   */
  onRefresh?: () => void;
  /**
   * Fired when the archive button is clicked in the thread header.
   * The parent should toggle is_archived on the conversation and
   * deselect it so the thread clears. Optional so existing callers
   * keep working.
   */
  onArchive?: (conversationId: string, isArchived: boolean) => void;
}

function formatDateSeparator(dateStr: string): string {
  const date = new Date(dateStr);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  return format(date, "MMMM d, yyyy");
}

function groupMessagesByDate(messages: Message[]) {
  const groups: { date: string; messages: Message[] }[] = [];
  let currentDate = "";

  for (const msg of messages) {
    const day = format(new Date(msg.created_at), "yyyy-MM-dd");
    if (day !== currentDate) {
      currentDate = day;
      groups.push({ date: msg.created_at, messages: [msg] });
    } else {
      groups[groups.length - 1].messages.push(msg);
    }
  }

  return groups;
}

const STATUS_OPTIONS: { label: string; value: ConversationStatus; color: string }[] = [
  { label: "Open", value: "open", color: "text-primary" },
  { label: "Pending", value: "pending", color: "text-amber-400" },
  { label: "Closed", value: "closed", color: "text-slate-400" },
];

/**
 * WhatsApp-style doodle background applied to the chat area (both the
 * active thread and the empty state). The SVG tile lives at
 * `/public/inbox-doodle.svg`; the slate-950 colour sits underneath so
 * the doodles read as a subtle pattern rather than a stark grid.
 *
 * Defined once at module scope so the two render paths can't drift —
 * if we ever switch the asset, both spots update together.
 */
const DOODLE_BG_CLASSES =
  "bg-slate-950 bg-[url('/inbox-doodle.svg')] bg-repeat";

export function MessageThread({
  conversation,
  contact,
  messages,
  onMessagesLoaded,
  onNewMessage,
  onUpdateMessage,
  onStatusChange,
  onAssignChange,
  onBack,
  resyncToken = 0,
  onRefresh,
  onArchive,
}: MessageThreadProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [templateModalOpen, setTemplateModalOpen] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  // Purely visual spin state for the manual-refresh button. The actual
  // refetch is fire-and-forget through `onRefresh` (which bumps the
  // parent's resyncToken); the 700ms spin is just feedback so the click
  // doesn't feel like a no-op. Cleared via the timer ref on unmount.
  const [isRefreshing, setIsRefreshing] = useState(false);
  // A tel: dial tells the browser nothing about how the call went, so
  // the same prompt the contact panel uses asks the agent afterwards.
  const [pendingDial, setPendingDial] = useState<PendingDial | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, []);
  const handleRefreshClick = useCallback(() => {
    if (isRefreshing || !onRefresh) return;
    setIsRefreshing(true);
    onRefresh();
    refreshTimerRef.current = setTimeout(() => {
      setIsRefreshing(false);
      refreshTimerRef.current = null;
    }, 700);
  }, [isRefreshing, onRefresh]);

  const handleArchiveClick = useCallback(async () => {
    if (!conversation) return;
    const newArchived = !conversation.is_archived;
    const supabase = createClient();
    const { data, error } = await supabase
      .from("conversations")
      .update({ is_archived: newArchived })
      .eq("id", conversation.id)
      .select("id");
    if (error || !data?.length) {
      toast.error("Failed to archive conversation");
      return;
    }
    onArchive?.(conversation.id, newArchived);
    toast.success(newArchived ? "Conversation archived" : "Conversation unarchived", {
      action: {
        label: "Undo",
        onClick: async () => {
          const supabase2 = createClient();
          await supabase2
            .from("conversations")
            .update({ is_archived: !newArchived })
            .eq("id", conversation.id);
          onArchive?.(conversation.id, !newArchived);
        },
      },
    });
  }, [conversation, onArchive]);
  const [replyTo, setReplyTo] = useState<ReplyDraft | null>(null);
  const [forwardMessage, setForwardMessage] = useState<Message | null>(null);

  // Profiles are bounded by RLS to rows the current user is allowed to
  // see — today that's just the current user, but the dropdown keeps the
  // shape ready for shared-team workspaces without a refactor.
  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("profiles")
      .select("*")
      .order("full_name")
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error("Failed to fetch profiles:", error);
          return;
        }
        setProfiles((data as Profile[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 24-hour session timer
  const sessionInfo = useMemo(() => {
    if (loading) return { expired: false, remaining: "Loading..." };
    if (!messages.length) return { expired: true, remaining: "No customer messages" };

    // Find last customer message
    const lastCustomerMsg = [...messages]
      .reverse()
      .find((m) => m.sender_type === "customer");

    if (!lastCustomerMsg) return { expired: true, remaining: "No customer messages" };

    const hoursSince = differenceInHours(new Date(), new Date(lastCustomerMsg.created_at));
    const expired = hoursSince >= 24;

    if (expired) {
      return { expired: true, remaining: "Expired" };
    }

    const hoursLeft = 24 - hoursSince;
    const remaining =
      hoursLeft >= 1
        ? `${Math.floor(hoursLeft)}h remaining`
        : `${Math.floor(hoursLeft * 60)}m remaining`;

    return { expired, remaining };
  }, [messages, loading]);

  // Store latest callback in a ref so fetchMessages doesn't need to
  // depend on `onMessagesLoaded` — otherwise parent re-renders cause
  // fetchMessages to change → useEffect re-fires → refetch → realtime
  // UPDATE on conversations.unread_count → parent re-renders → LOOP.
  // The ref is written inside an effect so the mutation doesn't happen
  // during render (React 19 refs rule); consumers only read `.current`
  // inside the async fetch completion, which runs after the render.
  const onMessagesLoadedRef = useRef(onMessagesLoaded);
  useEffect(() => {
    onMessagesLoadedRef.current = onMessagesLoaded;
  });

  // Same reason: pin/hide run inside an async handler and must see the
  // current list and callback, not the ones captured when it was built.
  const onUpdateMessageRef = useRef(onUpdateMessage);
  const messagesRef = useRef(messages);
  useEffect(() => {
    onUpdateMessageRef.current = onUpdateMessage;
    messagesRef.current = messages;
  });

  const lastConversationIdRef = useRef<string | null>(null);

  const conversationId = conversation?.id;
  const hasUnread = (conversation?.unread_count ?? 0) > 0;

  // Fetch messages whenever the selected conversation changes. Kept
  // separate from the unread-reset effect so that incoming messages
  // arriving while the thread is open don't trigger a full refetch —
  // they only flip hasUnread, which only the reset effect listens to.
  useEffect(() => {
    if (!conversationId) {
      lastConversationIdRef.current = null;
      return;
    }

    const supabase = createClient();
    let cancelled = false;

    const isConversationChange = lastConversationIdRef.current !== conversationId;
    lastConversationIdRef.current = conversationId;

    (async () => {
      if (isConversationChange) {
        setLoading(true);
      }

      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversationId)
        .order("created_at", { ascending: true });

      if (cancelled) return;

      if (error) {
        console.error("Failed to fetch messages:", error);
      } else {
        // A message hidden from the inbox must be hidden on every
        // surface. Without this it stays visible here while the mobile
        // thread has dropped it, and the two disagree about what the
        // conversation contains.
        onMessagesLoadedRef.current(visibleMessages(data ?? []));
      }

      if (!cancelled && isConversationChange) {
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // `resyncToken` is included so the parent can force a refetch when
    // the realtime channel reconnects or the tab regains focus —
    // realtime is best-effort and any message events sent while the WS
    // was disconnected or throttled are otherwise lost.
  }, [conversationId, resyncToken]);

  // Reactions fetch — pulls the current state from the DB. Kept separate
  // from the channel subscription below so a `resyncToken` bump just
  // refetches the rows without also tearing down and rebuilding the
  // realtime channel.
  useEffect(() => {
    if (!conversationId) {
      setReactions([]);
      return;
    }
    const supabase = createClient();
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("message_reactions")
        .select("*")
        .eq("conversation_id", conversationId);
      if (cancelled) return;
      if (error) {
        console.error("Failed to fetch reactions:", error);
        return;
      }
      setReactions((data as MessageReaction[]) ?? []);
    })();

    return () => {
      cancelled = true;
    };
  }, [conversationId, resyncToken]);

  // Reactions realtime subscription per conversation. Subscribing here
  // (not at the page level) keeps the channel scoped to the visible
  // conversation and avoids cross-conversation chatter on a busy inbox.
  useEffect(() => {
    if (!conversationId) return;
    const supabase = createClient();

    const channel = supabase
      .channel(`reactions:${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => {
            if (prev.some((r) => r.id === row.id)) return prev;
            // Swap any matching optimistic temp row for the real one so
            // the pill doesn't double up after a successful POST.
            const tempIdx = prev.findIndex(
              (r) =>
                r.id.startsWith("temp-") &&
                r.message_id === row.message_id &&
                r.actor_type === row.actor_type &&
                r.actor_id === row.actor_id,
            );
            if (tempIdx >= 0) {
              const copy = prev.slice();
              copy[tempIdx] = row;
              return copy;
            }
            return [...prev, row];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as MessageReaction;
          setReactions((prev) => prev.map((r) => (r.id === row.id ? row : r)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "message_reactions",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const old = payload.old as Partial<MessageReaction>;
          if (!old?.id) return;
          setReactions((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId]);

  // Clear any in-progress reply draft when the active conversation changes —
  // a quote pulled from conversation A shouldn't bleed into conversation B.
  useEffect(() => {
    setReplyTo(null);
    setForwardMessage(null);
  }, [conversationId]);

  // Reset the server-side unread_count to 0 whenever an unread count
  // surfaces on the active conversation — covers both (a) opening a
  // conversation that had unread messages and (b) new messages arriving
  // while the user is already viewing the thread (webhook server-bumps
  // unread_count to N+1; the realtime UPDATE propagates it into the
  // client, which re-runs this effect and flips it back to 0).
  //
  // Guarding on hasUnread prevents the eq-update loop: once unread_count
  // is 0 the condition is false, so no further UPDATE is issued.
  useEffect(() => {
    if (!conversationId || !hasUnread) return;
    const supabase = createClient();
    supabase
      .from("conversations")
      .update({ unread_count: 0 })
      .eq("id", conversationId)
      .select("id")
      .then(({ data, error }) => {
        if (error || !data?.length) {
          console.error(
            "Failed to reset unread_count:",
            error ?? "no conversation changed",
          );
        }
      });
  }, [conversationId, hasUnread]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      const el = scrollRef.current;
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleSend = useCallback(
    async (text: string, replyToId?: string) => {
      if (!conversation) return;

      const tempId = `temp-${Date.now()}`;

      // Optimistic update — shows the message immediately with "sending" status
      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "text",
        content_text: text,
        status: "sending",
        created_at: new Date().toISOString(),
        reply_to_message_id: replyToId,
      };
      onNewMessage(optimisticMsg);
      setReplyTo(null);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "text",
            content_text: text,
            reply_to_message_id: replyToId,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          const errorInfo = payload?.errorInfo;
          console.error("Failed to send message:", reason);

          // The 24-hour window has closed: free text can't reach this
          // contact, so open the template picker rather than leaving the
          // agent to work out why a plain retry keeps failing.
          if (isReengagementError(reason)) {
            toast.warning("This chat is past the 24-hour window", {
              description:
                "WhatsApp only allows an approved template now — pick one to re-engage.",
              duration: 8000,
            });
            onUpdateMessage(tempId, { status: "failed", error_info: reason });
            setTemplateModalOpen(true);
            return;
          }

          // Build user-friendly error message
          let userFriendlyError = reason;
          if (errorInfo?.userMessage) {
            userFriendlyError = errorInfo.userMessage;
            if (errorInfo.suggestedActions?.length > 0) {
              userFriendlyError += `\n\nSuggested actions:\n${errorInfo.suggestedActions.map((a: string) => `• ${a}`).join('\n')}`;
            }
          }
          
          toast.error(`Failed to send: ${errorInfo?.title || reason}`, {
            description: errorInfo?.userMessage || undefined,
            duration: 8000
          });
          
          // Mark the optimistic bubble as failed so the user sees what happened
          onUpdateMessage(tempId, { status: "failed", error_info: userFriendlyError });
          return;
        }

        // Success — the realtime INSERT event will replace the temp bubble
        // with the real DB row. If realtime hasn't arrived yet, at least
        // flip status to 'sent' so the UI stops showing "sending".
        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send message:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send: ${reason}`);
        onUpdateMessage(tempId, { status: "failed", error_info: reason });
      }
    },
    [conversation, onNewMessage, onUpdateMessage]
  );

  // Send a message again as a new one — the same path a typed message
  // takes, so a closed 24-hour window opens the template picker exactly
  // as it would for anything else.
  const handleResend = useCallback(
    (msg: Message) => {
      const text = actionableText(msg);
      if (!text) {
        toast.error("Nothing to send again");
        return;
      }
      void handleSend(text);
    },
    [handleSend],
  );

  const handleStatusChange = useCallback(
    async (status: ConversationStatus) => {
      if (!conversation) return;

      const supabase = createClient();
      const { data: statusSaved } = await supabase
        .from("conversations")
        .update({ status })
        .eq("id", conversation.id)
        .select("id");

      if (!statusSaved?.length) {
        toast.error("Failed to update status");
        return;
      }

      onStatusChange(conversation.id, status);
    },
    [conversation, onStatusChange]
  );

  const handleOpenTemplates = useCallback(() => {
    setTemplateModalOpen(true);
  }, []);

  const handleSendTemplate = useCallback(
    async (
      template: MessageTemplate,
      values: {
        body: string[];
        headerText?: string;
        buttonParams?: Record<number, string>;
      },
    ) => {
      if (!conversation) return;

      const renderedBody = renderTemplateBody(template.body_text, values.body);
      const tempId = `temp-${Date.now()}`;

      const optimisticMsg: Message = {
        id: tempId,
        conversation_id: conversation.id,
        sender_type: "agent",
        content_type: "template",
        content_text: renderedBody,
        template_name: template.name,
        status: "sending",
        created_at: new Date().toISOString(),
      };
      onNewMessage(optimisticMsg);

      try {
        const res = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "template",
            template_name: template.name,
            template_language: template.language,
            // Structured params drive the new send-builder path
            // (header media + URL button substitution). Body values
            // are mirrored under both shapes so the route can fall
            // back if the template row isn't found locally.
            template_message_params: {
              body: values.body,
              headerText: values.headerText,
              buttonParams: values.buttonParams,
            },
            template_params: values.body,
            content_text: renderedBody,
          }),
        });

        const payload = await res.json().catch(() => ({}));

        if (!res.ok) {
          const reason = payload?.error || `HTTP ${res.status}`;
          const errorInfo = payload?.errorInfo;
          console.error("Failed to send template:", reason);
          
          // Build user-friendly error message
          let userFriendlyError = reason;
          if (errorInfo?.userMessage) {
            userFriendlyError = errorInfo.userMessage;
            if (errorInfo.suggestedActions?.length > 0) {
              userFriendlyError += `\n\nSuggested actions:\n${errorInfo.suggestedActions.map((a: string) => `• ${a}`).join('\n')}`;
            }
          }
          
          toast.error(`Failed to send template: ${errorInfo?.title || reason}`, {
            description: errorInfo?.userMessage || undefined,
            duration: 8000
          });
          
          onUpdateMessage(tempId, { status: "failed", error_info: userFriendlyError });
          return;
        }

        onUpdateMessage(tempId, { status: "sent" });
      } catch (err) {
        console.error("Failed to send template:", err);
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Failed to send template: ${reason}`);
        onUpdateMessage(tempId, { status: "failed", error_info: reason });
      }
    },
    [conversation, onNewMessage, onUpdateMessage],
  );

  // Build a quick id → Message map so reply quotes can be rendered without
  // an extra fetch — the thread already holds the full conversation.
  const messagesById = useMemo(() => {
    const map = new Map<string, Message>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  // Bucket reactions by their target message_id for O(1) per-bubble lookup.
  const reactionsByMessageId = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const bucket = map.get(r.message_id);
      if (bucket) bucket.push(r);
      else map.set(r.message_id, [r]);
    }
    return map;
  }, [reactions]);

  const contactDisplayName = contact?.name || contact?.phone || "Customer";

  // Author label for a quoted message: "You" when we sent the parent,
  // contact name when the customer sent it.
  const authorLabelFor = useCallback(
    (m: Message): string => {
      const isAgentMsg =
        m.sender_type === "agent" || m.sender_type === "bot";
      return isAgentMsg ? "You" : contactDisplayName;
    },
    [contactDisplayName],
  );

  const handleStartReply = useCallback(
    (msg: Message) => {
      setReplyTo({
        id: msg.id,
        authorLabel: authorLabelFor(msg),
        preview: buildReplyPreview(msg),
      });
    },
    [authorLabelFor],
  );

  // Single reaction-set primitive. emoji === "" removes; otherwise adds/swaps.
  // The "toggle" semantic (pill click) is computed at the call site where the
  // current reactions for the bubble are already in scope — keeps this
  // function dependency-free w.r.t. the reaction list.
  /**
   * Upload an attachment, then send it.
   *
   * Two calls rather than one: a send refused by the 24-hour window
   * should not also cost the agent the upload, and the staged file can
   * be sent again once a template has reopened the window.
   */
  const handleSendAttachment = useCallback(
    async (file: File, caption: string | undefined, replyToId?: string) => {
      if (!conversation) return;
      try {
        const form = new FormData();
        form.append("file", file);
        const uploadRes = await fetch("/api/whatsapp/media/upload", {
          method: "POST",
          body: form,
        });
        const uploaded = await uploadRes.json();
        if (!uploadRes.ok) {
          // The route names the actual limit ("WhatsApp caps video at
          // 16 MB — this is 40 MB"), which is more use than "failed".
          throw new Error(uploaded.error || "Could not upload the attachment");
        }

        const sendRes = await fetch("/api/whatsapp/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversation_id: conversation.id,
            message_type: "media",
            media_url: uploaded.data.media_url,
            media_kind: uploaded.data.media_kind,
            media_filename: uploaded.data.filename,
            ...(caption ? { content_text: caption } : {}),
            ...(replyToId ? { reply_to_message_id: replyToId } : {}),
          }),
        });
        const sent = await sendRes.json();
        if (!sendRes.ok) {
          throw new Error(
            isReengagementError(sent.error)
              ? "Past the 24-hour window — an attachment needs the contact to write first, or a template."
              : sent.error || "Could not send the attachment",
          );
        }

        setReplyTo(null);
        onRefresh?.();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not send that");
      }
    },
    [conversation, onRefresh],
  );

  /**
   * Pin/unpin, or hide a message from this account's inbox.
   *
   * Neither reaches WhatsApp — Meta has no revoke endpoint, and its pin
   * endpoint takes group recipients only. The hide confirmation says so
   * verbatim, from the same constant the mobile thread uses.
   */
  const setMessageState = useCallback(
    async (message: Message, action: "pin" | "unpin" | "hide") => {
      if (message.id.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }
      try {
        const res = await fetch(`/api/whatsapp/messages/${message.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const payload = await res.json();
        if (!res.ok) throw new Error(payload.error || "That did not work");

        // The parent owns the message list, so a hide replaces it and a
        // pin patches the single row through the callbacks it provides.
        if (action === "hide") {
          onMessagesLoadedRef.current(
            messagesRef.current.filter((m) => m.id !== message.id),
          );
        } else {
          onUpdateMessageRef.current(message.id, {
            pinned_at: action === "pin" ? new Date().toISOString() : null,
          });
        }
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "That did not work");
      }
    },
    [],
  );

  const confirmHide = useCallback(
    (message: Message) => {
      // Confirmed every time. It sits where "delete for everyone" sits
      // in WhatsApp and does something entirely different.
      if (typeof window !== "undefined" && !window.confirm(HIDE_CONFIRM_MESSAGE)) {
        return;
      }
      void setMessageState(message, "hide");
    },
    [setMessageState],
  );

  const pinned = useMemo(() => pinnedMessages(messages), [messages]);

  const postReaction = useCallback(
    async (messageId: string, emoji: string) => {
      if (!user?.id || !conversation) {
        console.warn("[reactions] missing user or conversation");
        return;
      }
      if (messageId.startsWith("temp-")) {
        toast.error("Wait for the message to finish sending");
        return;
      }

      const convId = conversation.id;
      const userId = user.id;
      let snapshot: MessageReaction[] = [];

      // Functional updater — captures the freshest reactions list, never a
      // stale closure. Snapshot stored for rollback on POST failure.
      setReactions((prev) => {
        snapshot = prev;
        const own = prev.find(
          (r) =>
            r.message_id === messageId &&
            r.actor_type === "agent" &&
            r.actor_id === userId,
        );
        if (emoji === "") return own ? prev.filter((r) => r !== own) : prev;
        if (own) return prev.map((r) => (r === own ? { ...own, emoji } : r));
        return [
          ...prev,
          {
            id: `temp-${Date.now()}`,
            message_id: messageId,
            conversation_id: convId,
            actor_type: "agent",
            actor_id: userId,
            emoji,
            created_at: new Date().toISOString(),
          },
        ];
      });

      try {
        const res = await fetch("/api/whatsapp/react", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message_id: messageId, emoji }),
        });
        if (!res.ok) {
          const payload = await res.json().catch(() => ({}));
          throw new Error(payload?.error || `HTTP ${res.status}`);
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "network error";
        toast.error(`Reaction failed: ${reason}`);
        setReactions(snapshot);
      }
    },
    [conversation, user?.id],
  );

  const handleAssignChange = useCallback(
    async (agentId: string | null) => {
      if (!conversation) return;

      // assigned_team_id must follow the new agent's own team — the
      // org-hierarchy RLS policies (migration 082) grant a Leader
      // visibility via assigned_team_id, not assigned_agent_id, so
      // leaving it stale here would make a manually-assigned
      // conversation invisible to the assignee's own Leader. Same
      // sync handoff_contact does for contacts (migration 083).
      const teamId = agentId ? profiles.find((p) => p.user_id === agentId)?.team_id ?? null : null;

      const supabase = createClient();
      const { data: assigned, error } = await supabase
        .from("conversations")
        .update({ assigned_agent_id: agentId, assigned_team_id: teamId })
        .eq("id", conversation.id)
        .select("id");

      if (error || !assigned?.length) {
        console.error("Failed to update assignment:", error);
        toast.error("Failed to update assignment");
        return;
      }

      onAssignChange(conversation.id, agentId, teamId);
    },
    [conversation, onAssignChange, profiles],
  );

  // Empty state — same WhatsApp-style doodle background as the active
  // thread below, so swapping between empty/selected doesn't change the
  // pattern under the user's eye.
  if (!conversation || !contact) {
    return (
      <div className={cn("flex flex-1 flex-col items-center justify-center relative overflow-hidden min-w-0", DOODLE_BG_CLASSES)}>
        {/* Ambient background glows */}
        <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-primary/8 rounded-full blur-[80px] pointer-events-none" />
        <div className="absolute bottom-1/4 right-1/4 w-[250px] h-[250px] bg-indigo-500/5 rounded-full blur-[70px] pointer-events-none" />
        
        <div className="relative z-10 flex flex-col items-center justify-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent border border-primary/25 shadow-lg shadow-primary/5">
            <MessageSquare className="h-8 w-8 text-primary" />
          </div>
          <h3 className="mt-6 text-base font-extrabold text-white tracking-tight">
            Select a conversation
          </h3>
          <p className="mt-1.5 text-xs text-slate-400 font-medium max-w-xs text-center leading-relaxed">
            Choose a conversation from the left to view messaging threads, respond directly, or trigger workflows.
          </p>
        </div>
      </div>
    );
  }

  const displayName = contact.name || contact.phone;
  const messageGroups = groupMessagesByDate(messages);
  const currentStatus = STATUS_OPTIONS.find(
    (s) => s.value === conversation.status
  );
  const assignedAgentId = conversation.assigned_agent_id ?? null;
  const currentAssignee = profiles.find((p) => p.user_id === assignedAgentId);
  const assignLabel = assignedAgentId
    ? (currentAssignee?.full_name ?? "Assigned")
    : "Assign";

  return (
    // `min-w-0` mirrors the pane wrappers in inbox/page.tsx (issue
    // #165): this root is itself a flex item, and without it the
    // header/content intrinsic width sets the min-width — on phones
    // the whole thread (header, bubbles, composer) rendered wider
    // than the viewport and bled off the right edge.
    <div className={cn("flex flex-1 flex-col relative min-w-0", DOODLE_BG_CLASSES)}>
      {/* Header — translucent backdrop-blur seats on top of the doodle */}
      <div className="flex items-center justify-between gap-2 border-b border-slate-900/60 bg-slate-950/70 backdrop-blur-md px-3 py-3 sm:px-4 relative z-10">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          {/* Back-to-list button — mobile only. Hidden on lg+ where the
              conversation list is always visible next to the thread. */}
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back to conversations"
              className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white lg:hidden"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
          )}
          <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-medium text-white">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <h2 className="truncate text-sm font-semibold text-white">{displayName}</h2>
              {contact.name && <NameTagBadge tag={contact.name_tag} />}
              {contact.phone && (
                <a
                  href={`tel:${contact.phone}`}
                  aria-label={`Call ${displayName}`}
                  title={`Call ${contact.phone}`}
                  onClick={() =>
                    setPendingDial({
                      contactId: contact.id,
                      name: contact.name,
                      phone: contact.phone,
                      dialedAt: new Date().toISOString(),
                    })
                  }
                  className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary transition-colors hover:bg-primary/25"
                >
                  <Phone className="size-3" />
                </a>
              )}
            </div>
            <p className="truncate text-xs text-slate-400">{contact.phone}</p>
          </div>
          {/* Session timer badge — hidden on the narrowest phones so
              the name + back arrow keep their room. */}
          <Badge
            variant="outline"
            className={cn(
              "ml-1 hidden gap-1 border-slate-700 text-[10px] sm:inline-flex sm:ml-2",
              sessionInfo.expired ? "text-red-400" : "text-primary"
            )}
          >
            <Clock className="h-3 w-3" />
            {sessionInfo.remaining}
          </Badge>
        </div>

        <div className="flex items-center gap-2">
          {/* Journey mind map — this contact's property funnel. */}
          <Link
            href={`/journey?contact=${contact.id}`}
            aria-label="Open journey mind map"
            title="Journey map"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-primary"
          >
            <Waypoints className="h-3.5 w-3.5" />
          </Link>

          {/* Manual refresh — forces a refetch of the messages + the
              conversation list (the parent bumps its resyncToken). Useful
              when realtime missed an event or the agent just wants to be
              sure nothing's stale. Only rendered when the parent wires
              up `onRefresh`. */}
          {onRefresh && (
            <button
              type="button"
              onClick={handleRefreshClick}
              disabled={isRefreshing}
              aria-label="Refresh conversation"
              title="Refresh"
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-60",
              )}
            >
              <RefreshCw
                className={cn("h-3.5 w-3.5", isRefreshing && "animate-spin")}
              />
            </button>
          )}

          {/* Archive / Unarchive button */}
          <button
            type="button"
            onClick={handleArchiveClick}
            aria-label={conversation.is_archived ? "Unarchive conversation" : "Archive conversation"}
            title={conversation.is_archived ? "Unarchive" : "Archive"}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-800 hover:text-amber-400"
          >
            {conversation.is_archived
              ? <ArchiveRestore className="h-3.5 w-3.5" />
              : <Archive className="h-3.5 w-3.5" />}
          </button>

          {/* Status dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger className={cn(
                  "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-slate-800",
                  currentStatus?.color ?? "text-slate-400"
                )}>
                {currentStatus?.label ?? "Status"}
                <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-slate-700 bg-slate-800"
            >
              {STATUS_OPTIONS.map((opt) => (
                <DropdownMenuItem
                  key={opt.value}
                  onClick={() => handleStatusChange(opt.value)}
                  className={cn("text-sm", opt.color)}
                >
                  {opt.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Assign dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                "inline-flex items-center justify-center h-7 gap-1 px-2 text-xs rounded-md hover:bg-slate-800",
                assignedAgentId ? "text-primary" : "text-slate-400"
              )}
            >
              <UserPlus className="h-3 w-3" />
              <span className="hidden sm:inline">{assignLabel}</span>
              <ChevronDown className="h-3 w-3" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="border-slate-700 bg-slate-800"
            >
              {profiles.length === 0 ? (
                <DropdownMenuItem disabled className="text-sm text-slate-500">
                  No teammates available
                </DropdownMenuItem>
              ) : (
                profiles.map((p) => {
                  const isSelected = p.user_id === assignedAgentId;
                  return (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => handleAssignChange(p.user_id)}
                      className={cn(
                        "text-sm",
                        isSelected ? "text-primary" : "text-slate-300"
                      )}
                    >
                      <span className="flex-1">
                        {p.full_name}
                        {p.user_id === user?.id ? " (me)" : ""}
                      </span>
                      {isSelected && <Check className="ml-2 h-3 w-3" />}
                    </DropdownMenuItem>
                  );
                })
              )}
              {assignedAgentId && (
                <>
                  <DropdownMenuSeparator className="bg-slate-700" />
                  <DropdownMenuItem
                    onClick={() => handleAssignChange(null)}
                    className="text-sm text-slate-400"
                  >
                    Unassign
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Messages Area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <MessageBubbleLoader size={104} label="Loading messages" className="mb-3" />
            <ConvoRealLoader size={20} className="mb-2" />
            <p className="text-sm">Loading messages...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <p className="text-sm text-slate-500">No messages yet</p>
            <p className="text-xs text-slate-600">
              Send a template to start the conversation
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {pinned.length > 0 && (
              <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-1.5 rounded-lg border border-slate-800 bg-slate-900/90 px-2 py-1.5 backdrop-blur-sm">
                {pinned.map((msg) => (
                  <button
                    key={msg.id}
                    type="button"
                    onClick={() => void setMessageState(msg, "unpin")}
                    title="Click to unpin — the contact sees no change either way"
                    className="flex max-w-60 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800/60 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    <Pin className="h-3 w-3 shrink-0 text-violet-400" />
                    <span className="truncate">
                      {actionableText(msg) || `[${msg.content_type}]`}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {messageGroups.map((group) => (
              <div key={group.date}>
                {/* Date separator */}
                <div className="mb-4 flex items-center justify-center">
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-[10px] font-medium text-slate-400">
                    {formatDateSeparator(group.date)}
                  </span>
                </div>
                {/* Messages */}
                <div className="space-y-2">
                  {group.messages.map((msg) => {
                    const parent = msg.reply_to_message_id
                      ? messagesById.get(msg.reply_to_message_id)
                      : null;
                    const reply = parent
                      ? {
                          authorLabel: authorLabelFor(parent),
                          preview: buildReplyPreview(parent),
                        }
                      : null;
                    const msgReactions = reactionsByMessageId.get(msg.id);
                    // Toggle is computed at the call site — `msgReactions`
                    // and `user?.id` are already in scope, no extra hook.
                    const handlePillToggle = (emoji: string) => {
                      const own = msgReactions?.find(
                        (r) =>
                          r.actor_type === "agent" &&
                          r.actor_id === user?.id,
                      );
                      const next = own?.emoji === emoji ? "" : emoji;
                      void postReaction(msg.id, next);
                    };
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                        onResend={() => handleResend(msg)}
                        onForward={() => setForwardMessage(msg)}
                        onTogglePin={() => void setMessageState(msg, pinAction(msg))}
                        onHide={() => confirmHide(msg)}
                      >
                        <MessageBubble
                          message={msg}
                          reply={reply}
                          reactions={msgReactions}
                          currentUserId={user?.id}
                          onToggleReaction={handlePillToggle}
                        />
                      </MessageActions>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <MessageComposer
        conversationId={conversation.id}
        sessionExpired={sessionInfo.expired}
        onSend={handleSend}
        onSendAttachment={handleSendAttachment}
        onOpenTemplates={handleOpenTemplates}
        replyTo={replyTo}
        onClearReply={() => setReplyTo(null)}
        contactDead={Boolean(contact?.is_dead || contact?.is_archived)}
      />

      <TemplatePicker
        open={templateModalOpen}
        onOpenChange={setTemplateModalOpen}
        onSelect={handleSendTemplate}
      />

      <ForwardMessageDialog
        message={forwardMessage}
        onOpenChange={(open) => {
          if (!open) setForwardMessage(null);
        }}
      />

      <LogCallPrompt
        dial={pendingDial}
        onOpenChange={(next) => {
          if (!next) setPendingDial(null);
        }}
      />
    </div>
  );
}
